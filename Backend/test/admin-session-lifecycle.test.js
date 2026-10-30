import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { SignJWT, decodeJwt } from 'jose';
import { generateSecret, generate } from 'otplib';
import app from '../src/app.js';
import { environment, jwtKey, pool } from '../src/config.js';
import { hashPassword } from '../src/auth.js';
import { encryptSecret } from '../src/utils/mfa.js';

if (environment !== 'development' || !new URL(process.env.DATABASE_URL).pathname.includes('_tdd_'))
  throw Error('Isolated development database required');

const digest = value => createHash('sha256').update(value).digest('hex');
const encryptionKey = createHmac('sha256', jwtKey).update('billease/admin-browser-session/v1').digest();
function encrypt(value) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}
function decrypt(value) {
  const bytes = Buffer.from(value, 'base64url'), decipher = createDecipheriv('aes-256-gcm', encryptionKey, bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
}

test('admin browser sessions enforce expiry, revocation and serialized refresh', async () => {
  let server;
  try {
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const password = 'A strong lifecycle test password 52';
    async function login(label) {
      const userId = randomUUID(), email = `${userId}@example.com`, secret = generateSecret();
      await pool.query('INSERT INTO users(id,email,password_hash,is_admin) VALUES ($1,$2,$3,true)', [userId, email, await hashPassword(password)]);
      await pool.query('INSERT INTO mfa_enrolments(user_id,secret,active) VALUES ($1,$2,true)', [userId, encryptSecret(secret)]);
      const response = await fetch(`${origin}/admin/api/login`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Requested-With': 'BillEaseAdmin' },
        body: JSON.stringify({ email, password, mfaCode: await generate({ secret }) }),
      });
      assert.equal(response.status, 200, `${label} admin login`);
      const data = await response.json();
      const rawCookie = response.headers.getSetCookie().find(value => value.startsWith('billease_admin_development='));
      assert.ok(rawCookie, `${label} browser cookie`);
      const cookie = rawCookie.split(';')[0];
      const token = cookie.slice('billease_admin_development='.length);
      assert.match(token, /^[a-f0-9]{64}$/);
      const stored = (await pool.query('SELECT token_hash,token_state,device_id FROM admin_web_sessions WHERE token_hash=$1', [digest(token)])).rows[0];
      assert.ok(stored);
      assert.notEqual(stored.token_hash, token);
      return { userId, token, cookie, csrfToken: data.csrfToken, deviceId: stored.device_id };
    }
    const headersFor = session => ({ Cookie: session.cookie, 'X-Requested-With': 'BillEaseAdmin' });
    async function getSession(session) {
      return fetch(`${origin}/admin/api/session`, { headers: headersFor(session) });
    }

    // Idle timeout revokes the refresh family and removes the opaque web session.
    const idle = await login('idle expiry');
    await pool.query("UPDATE admin_web_sessions SET last_seen_at=now()-interval '31 minutes' WHERE token_hash=$1", [digest(idle.token)]);
    assert.equal((await getSession(idle)).status, 401);
    assert.equal((await pool.query('SELECT count(*)::int count FROM admin_web_sessions WHERE token_hash=$1', [digest(idle.token)])).rows[0].count, 0);
    assert.equal((await pool.query('SELECT count(*)::int count FROM refresh_sessions WHERE device_id=$1 AND revoked_at IS NULL', [idle.deviceId])).rows[0].count, 0);

    // Absolute lifetime is enforced independently of recent activity.
    const absolute = await login('absolute expiry');
    await pool.query("UPDATE admin_web_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1", [digest(absolute.token)]);
    assert.equal((await getSession(absolute)).status, 401);
    assert.equal((await pool.query('SELECT count(*)::int count FROM refresh_sessions WHERE device_id=$1 AND revoked_at IS NULL', [absolute.deviceId])).rows[0].count, 0);

    // Browser cookies are scoped to the admin website and never authorize /v1.
    const apiIsolation = await login('API isolation');
    assert.equal((await fetch(`${origin}/v1/me`, { headers: { Cookie: apiIsolation.cookie } })).status, 401);

    // Current user/device/admin state is checked on every browser request.
    const userRevoked = await login('user revocation');
    await pool.query('UPDATE users SET active=false WHERE id=$1', [userRevoked.userId]);
    assert.equal((await getSession(userRevoked)).status, 401);

    const deviceRevoked = await login('device revocation');
    await pool.query('UPDATE devices SET active=false WHERE id=$1', [deviceRevoked.deviceId]);
    assert.equal((await getSession(deviceRevoked)).status, 401);

    const adminRevoked = await login('admin role revocation');
    await pool.query('UPDATE users SET is_admin=false WHERE id=$1', [adminRevoked.userId]);
    assert.equal((await getSession(adminRevoked)).status, 403);

    // Expire only the access token while keeping the saved refresh token valid.
    const concurrent = await login('concurrent refresh');
    const sessionRow = (await pool.query('SELECT token_state FROM admin_web_sessions WHERE token_hash=$1', [digest(concurrent.token)])).rows[0];
    const tokens = decrypt(sessionRow.token_state), prior = decodeJwt(tokens.accessToken), now = Math.floor(Date.now() / 1000);
    tokens.accessToken = await new SignJWT({ sid: prior.sid, purpose: 'access' })
      .setProtectedHeader({ alg: 'HS256' }).setSubject(prior.sub).setIssuer('billease').setAudience('billease-api')
      .setIssuedAt(now - 120).setExpirationTime(now - 1).sign(jwtKey);
    await pool.query('UPDATE admin_web_sessions SET token_state=$2 WHERE token_hash=$1', [digest(concurrent.token), encrypt(tokens)]);
    const requests = await Promise.all(Array.from({ length: 6 }, () => getSession(concurrent)));
    assert.deepEqual(requests.map(response => response.status), Array(6).fill(200));
    const family = await pool.query('SELECT revoked_at FROM refresh_sessions WHERE device_id=$1', [concurrent.deviceId]);
    assert.equal(family.rowCount, 2, 'one consumed and one rotated refresh token remain in the device family');
    assert.equal(family.rows.filter(row => row.revoked_at === null).length, 1, 'concurrent tabs leave exactly one active refresh token');
    const finalState = decrypt((await pool.query('SELECT token_state FROM admin_web_sessions WHERE token_hash=$1', [digest(concurrent.token)])).rows[0].token_state);
    const finalAccess = decodeJwt(finalState.accessToken);
    assert.ok(finalAccess.exp > Math.floor(Date.now() / 1000), 'saved access token was rotated to a live token');
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await pool.end();
  }
});
