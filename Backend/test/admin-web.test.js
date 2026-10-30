import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { generateSecret, generate } from "otplib";
import app from "../src/app.js";
import { pool } from "../src/config.js";
import { hashPassword } from "../src/auth.js";
import { encryptSecret } from "../src/utils/mfa.js";
import { rotateRecoveryCodes } from "../src/services/mfa-management.js";
if (
  process.env.APP_ENV !== "development" ||
  !new URL(process.env.DATABASE_URL).pathname.includes("_tdd_")
)
  throw Error("Isolated development database required");
test("admin website uses scoped cookies, CSRF, MFA and nonfinancial setup APIs", async () => {
  let server;
  try {
    const userId = randomUUID(),
      secret = generateSecret(),
      password = "A strong test password 52";
    await pool.query(
      "INSERT INTO users(id,email,password_hash,is_admin) VALUES ($1,$2,$3,true)",
      [userId, `${userId}@example.com`, await hashPassword(password)],
    );
    await pool.query(
      "INSERT INTO mfa_enrolments(user_id,secret,active) VALUES ($1,$2,true)",
      [userId, encryptSecret(secret)],
    );
    const adminRecoveryCode = "a".repeat(32);
    await pool.query(
      "INSERT INTO recovery_codes(user_id,code_hash) VALUES ($1,$2)",
      [userId, createHash("sha256").update(adminRecoveryCode).digest("hex")],
    );
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}`;
    const get = await fetch(`${origin}/admin/api/session`);
    assert.equal(get.status, 401);
    const login = await fetch(`${origin}/admin/api/login`, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        "X-Requested-With": "BillEaseAdmin",
      },
      body: JSON.stringify({
        email: `${userId}@example.com`,
        password,
        mfaCode: await generate({ secret }),
      }),
    });
    assert.equal(login.status, 200);
    const data = await login.json();
    assert.equal(data.user.isAdmin, true);
    assert.ok(data.csrfToken);
    assert.equal(data.accessToken, undefined);
    const rawCookie = login.headers
      .getSetCookie()
      .find((c) => c.startsWith("billease_admin_development="));
    assert.match(rawCookie, /HttpOnly/i);
    assert.match(rawCookie, /SameSite=Strict/i);
    assert.match(rawCookie, /Path=\/admin/i);
    const cookie = rawCookie.split(";")[0];
    const headers = {
      Origin: origin,
      Cookie: cookie,
      "Content-Type": "application/json",
      "X-CSRF-Token": data.csrfToken,
      "X-Requested-With": "BillEaseAdmin",
    };
    const cross = await fetch(`${origin}/admin/api/businesses`, {
      method: "POST",
      headers: { ...headers, Origin: "https://attacker.example" },
      body: JSON.stringify({ id: randomUUID(), name: "Bad" }),
    });
    assert.equal(cross.status, 403);
    const noCsrf = await fetch(`${origin}/admin/api/businesses`, {
      method: "POST",
      headers: { ...headers, "X-CSRF-Token": "bad" },
      body: JSON.stringify({ id: randomUUID(), name: "Bad" }),
    });
    assert.equal(noCsrf.status, 403);
    const businessId = randomUUID();
    for (let i = 0; i < 2; i++) {
      const res = await fetch(`${origin}/admin/api/businesses`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: businessId,
          name: "Shop",
          documentMode: "composition",
        }),
      });
      assert.equal(res.status, 201);
    }
    const account = randomUUID();
    for (let i = 0; i < 2; i++) {
      const res = await fetch(`${origin}/admin/api/users`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: account,
          email: `${account}@example.com`,
          password,
        }),
      });
      assert.equal(res.status, 201);
    }
    const membership = { userId: account, businessId, role: "owner" };
    for (let i = 0; i < 2; i++) {
      const res = await fetch(`${origin}/admin/api/memberships`, {
        method: "POST",
        headers,
        body: JSON.stringify(membership),
      });
      assert.equal(res.status, 201);
    }
    const lastOwner = await fetch(
      `${origin}/admin/api/businesses/${businessId}/memberships/${account}`,
      { method: "DELETE", headers },
    );
    assert.equal(lastOwner.status, 409);
    const rotated = await fetch(`${origin}/admin/api/mfa/recovery-codes`, {
      method: "POST",
      headers,
      body: JSON.stringify({ password, recoveryCode: adminRecoveryCode }),
    });
    assert.equal(rotated.status, 200);
    assert.equal((await rotated.json()).recoveryCodes.length, 10);
    const ownerId = randomUUID(),
      ownerSecret = generateSecret(),
      ownerPassword = "A strong owner password 52";
    await pool.query(
      "INSERT INTO users(id,email,password_hash) VALUES ($1,$2,$3)",
      [ownerId, `${ownerId}@example.com`, await hashPassword(ownerPassword)],
    );
    await pool.query(
      "INSERT INTO memberships(user_id,business_id,role) VALUES ($1,$2,'owner')",
      [ownerId, businessId],
    );
    await pool.query(
      "INSERT INTO mfa_enrolments(user_id,secret,active) VALUES ($1,$2,true)",
      [ownerId, encryptSecret(ownerSecret)],
    );
    await rotateRecoveryCodes(ownerId, {
      password: ownerPassword,
      mfaCode: await generate({ secret: ownerSecret }),
    });
    const directory = await fetch(`${origin}/admin/api/directory`, { headers });
    assert.equal(directory.status, 200);
    const rows = await directory.json();
    assert.ok(rows.businesses.some((b) => b.id === businessId));
    assert.ok(rows.auditEvents.some((e) => e.action === "business.created"));
    assert.doesNotMatch(
      JSON.stringify(rows),
      /password_hash|refreshToken|accessToken|total_minor|public_key/,
    );
    assert.ok(
      rows.auditEvents.some(
        (e) =>
          e.action === "mfa.recovery_codes_rotated" && e.actor_id === userId,
      ),
      "admin recovery-code rotation is visible",
    );
    assert.ok(
      !rows.auditEvents.some(
        (e) =>
          e.action === "mfa.recovery_codes_rotated" && e.actor_id === ownerId,
      ),
      "owner recovery-code rotation is excluded from the admin feed",
    );
    assert.equal(
      (await fetch(`${origin}/v1/me`, { headers: { Cookie: cookie } })).status,
      401,
      "admin cookies never authenticate mobile/operational APIs",
    );
    const loggedOut = await fetch(`${origin}/admin/api/logout`, {
      method: "POST",
      headers,
      body: "{}",
    });
    assert.equal(loggedOut.status, 200);
    assert.equal(
      (
        await fetch(`${origin}/admin/api/session`, {
          headers: { Cookie: cookie },
        })
      ).status,
      401,
    );
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
    await pool.end();
  }
});
