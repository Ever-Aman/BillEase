import { pool, transaction } from "../config.js";
import { hashPassword, verifyPassword, issueToken } from "../auth.js";
import { hash } from "../utils/validation.js";
import {
  randomBytes,
  randomUUID,
  createHash,
  timingSafeEqual,
  createPublicKey,
} from "node:crypto";
import { verifyMfa } from "../utils/mfa.js";
function refreshValue(id) {
  return `${id}.${randomBytes(32).toString("base64url")}`;
}
function tokenHash(value) {
  return createHash("sha256").update(value).digest("hex");
}
export async function login(
  email,
  password,
  deviceId,
  deviceName,
  mfaCode,
  recoveryCode,
  devicePublicKey,
) {
  let publicKey;
  try {
    publicKey = createPublicKey({
      key: Buffer.from(devicePublicKey, "base64"),
      format: "der",
      type: "spki",
    });
    if (publicKey.asymmetricKeyType !== "ed25519")
      throw new Error("Wrong key type");
  } catch {
    throw Object.assign(new Error("Invalid device public key"), {
      status: 400,
    });
  }
  const key = hash(email.toLowerCase());
  const limit = await pool.query(
    "SELECT locked_until FROM login_limits WHERE key_hash=$1",
    [key],
  );
  if (
    limit.rows[0]?.locked_until &&
    new Date(limit.rows[0].locked_until) > new Date()
  )
    throw Object.assign(new Error("Try again later"), { status: 429 });
  const { rows } = await pool.query(
    "SELECT id,password_hash,is_admin FROM users WHERE lower(email)=lower($1) AND active=true",
    [email],
  );
  if (!rows[0] || !(await verifyPassword(password, rows[0].password_hash))) {
    await pool.query(
      "INSERT INTO login_limits(key_hash,failures,locked_until) VALUES ($1,1,NULL) ON CONFLICT (key_hash) DO UPDATE SET failures=CASE WHEN login_limits.updated_at < now()-interval '15 minutes' THEN 1 ELSE login_limits.failures+1 END, locked_until=CASE WHEN login_limits.failures >= 4 AND login_limits.updated_at >= now()-interval '15 minutes' THEN now()+interval '15 minutes' ELSE NULL END, updated_at=now()",
      [key],
    );
    throw Object.assign(new Error("Invalid credentials"), { status: 401 });
  }
  const session = await transaction(async (db) => {
    const current = (
      await db.query(
        "SELECT password_hash,is_admin FROM users WHERE id=$1 AND active=true FOR UPDATE",
        [rows[0].id],
      )
    ).rows[0];
    if (!current || current.password_hash !== rows[0].password_hash)
      throw Object.assign(new Error("Invalid credentials"), { status: 401 });
    const enrolled = await db.query(
      "SELECT active FROM mfa_enrolments WHERE user_id=$1",
      [rows[0].id],
    );
    if (current.is_admin || enrolled.rows[0]?.active) {
      let verified = mfaCode ? await verifyMfa(db, rows[0].id, mfaCode) : false;
      if (!verified && recoveryCode) {
        const codeHash = tokenHash(recoveryCode);
        const used = await db.query(
          "UPDATE recovery_codes SET used_at=now() WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL RETURNING code_hash",
          [rows[0].id, codeHash],
        );
        verified = used.rowCount > 0;
      }
      if (!verified) return { mfaFailed: true };
    }
    const device = await db.query(
      "SELECT user_id,active,public_key FROM devices WHERE id=$1 FOR UPDATE",
      [deviceId],
    );
    if (
      device.rows[0] &&
      (device.rows[0].user_id !== rows[0].id || !device.rows[0].active)
    )
      throw Object.assign(new Error("Device unavailable"), { status: 403 });
    if (
      device.rows[0]?.public_key &&
      device.rows[0].public_key !== devicePublicKey
    )
      throw Object.assign(new Error("Device key mismatch"), { status: 403 });
    let lease;
    if (!device.rowCount)
      lease = await db.query(
        "INSERT INTO devices(id,user_id,name,public_key,last_authorized_at,offline_expires_at) VALUES ($1,$2,$3,$4,now(),now()+interval '7 days') RETURNING last_authorized_at,offline_expires_at",
        [deviceId, rows[0].id, deviceName, devicePublicKey],
      );
    else
      lease = await db.query(
        "UPDATE devices SET public_key=COALESCE(public_key,$2),last_seen_at=now(),last_authorized_at=now(),offline_expires_at=now()+interval '7 days' WHERE id=$1 RETURNING last_authorized_at,offline_expires_at",
        [deviceId, devicePublicKey],
      );
    const sessionId = randomUUID(),
      refreshToken = refreshValue(sessionId);
    await db.query(
      "INSERT INTO refresh_sessions(id,device_id,user_id,token_hash,expires_at) VALUES ($1,$2,$3,$4,now()+interval '30 days')",
      [sessionId, deviceId, rows[0].id, tokenHash(refreshToken)],
    );
    const memberships = await db.query(
      "SELECT business_id,role FROM memberships WHERE user_id=$1 AND active=true",
      [rows[0].id],
    );
    return {
      accessToken: await issueToken(rows[0], sessionId),
      refreshToken,
      expiresIn: 900,
      lastAuthorizedAt: lease.rows[0].last_authorized_at,
      offlineExpiresAt: lease.rows[0].offline_expires_at,
      memberships: memberships.rows,
    };
  });
  if (session.mfaFailed) {
    await pool.query(
      "INSERT INTO login_limits(key_hash,failures,locked_until) VALUES ($1,1,NULL) ON CONFLICT (key_hash) DO UPDATE SET failures=login_limits.failures+1, locked_until=CASE WHEN login_limits.failures>=4 THEN now()+interval '15 minutes' ELSE NULL END, updated_at=now()",
      [key],
    );
    throw Object.assign(new Error("MFA required or invalid"), { status: 401 });
  }
  await pool.query("DELETE FROM login_limits WHERE key_hash=$1", [key]);
  return session;
}
export async function refreshSession(refreshToken, existingDb) {
  const [sessionId] = refreshToken.split(".");
  if (!/^[0-9a-f-]{36}$/i.test(sessionId))
    throw Object.assign(new Error("Invalid refresh token"), { status: 401 });
  const run = async (db) => {
    const reference = (
      await db.query(
        "SELECT user_id,device_id FROM refresh_sessions WHERE id=$1",
        [sessionId],
      )
    ).rows[0];
    if (!reference)
      throw Object.assign(new Error("Invalid refresh token"), { status: 401 });
    // The same user -> device -> session order is used for MFA and revocation.
    await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
      reference.user_id,
    ]);
    await db.query("SELECT id FROM devices WHERE id=$1 FOR UPDATE", [
      reference.device_id,
    ]);
    const { rows } = await db.query(
      "SELECT s.*,d.active device_active,u.active user_active FROM refresh_sessions s JOIN devices d ON d.id=s.device_id JOIN users u ON u.id=s.user_id WHERE s.id=$1 FOR UPDATE OF s",
      [sessionId],
    );
    const old = rows[0];
    if (!old)
      throw Object.assign(new Error("Invalid refresh token"), { status: 401 });
    const actual = Buffer.from(tokenHash(refreshToken), "hex"),
      saved = Buffer.from(old.token_hash, "hex");
    if (!timingSafeEqual(actual, saved))
      throw Object.assign(new Error("Invalid refresh token"), { status: 401 });
    if (old.revoked_at) {
      await db.query(
        "UPDATE refresh_sessions SET revoked_at=now() WHERE device_id=$1 AND revoked_at IS NULL",
        [old.device_id],
      );
      return { reused: true };
    }
    if (
      !old.device_active ||
      !old.user_active ||
      new Date(old.expires_at) <= new Date()
    )
      throw Object.assign(new Error("Session expired"), { status: 401 });
    await db.query("UPDATE refresh_sessions SET revoked_at=now() WHERE id=$1", [
      sessionId,
    ]);
    const nextId = randomUUID(),
      nextToken = refreshValue(nextId);
    await db.query(
      "INSERT INTO refresh_sessions(id,device_id,user_id,token_hash,expires_at) VALUES ($1,$2,$3,$4,now()+interval '30 days')",
      [nextId, old.device_id, old.user_id, tokenHash(nextToken)],
    );
    const lease = await db.query(
      "UPDATE devices SET last_seen_at=now(),last_authorized_at=now(),offline_expires_at=now()+interval '7 days' WHERE id=$1 RETURNING last_authorized_at,offline_expires_at",
      [old.device_id],
    );
    const memberships = await db.query(
      "SELECT business_id,role FROM memberships WHERE user_id=$1 AND active=true",
      [old.user_id],
    );
    return {
      accessToken: await issueToken({ id: old.user_id }, nextId),
      refreshToken: nextToken,
      expiresIn: 900,
      lastAuthorizedAt: lease.rows[0].last_authorized_at,
      offlineExpiresAt: lease.rows[0].offline_expires_at,
      memberships: memberships.rows,
    };
  };
  const outcome = existingDb ? await run(existingDb) : await transaction(run);
  if (outcome.reused)
    throw Object.assign(new Error("Refresh token reused"), { status: 401 });
  return outcome;
}
export async function logoutSession(refreshToken) {
  const [id] = refreshToken.split(".");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { loggedOut: true };
  return transaction(async (db) => {
    const session = (
      await db.query(
        "SELECT user_id,device_id FROM refresh_sessions WHERE id=$1 AND token_hash=$2",
        [id, tokenHash(refreshToken)],
      )
    ).rows[0];
    if (session) {
      await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        session.user_id,
      ]);
      await db.query(
        "UPDATE refresh_sessions SET revoked_at=now() WHERE device_id=$1 AND revoked_at IS NULL",
        [session.device_id],
      );
      await db.query("DELETE FROM push_tokens WHERE device_id=$1", [
        session.device_id,
      ]);
    }
    return { loggedOut: true };
  });
}
export async function businessesForUser(userId) {
  const { rows } = await pool.query(
    'SELECT b.id,b.name,m.role,b.document_mode AS "documentMode",b.document_profile->>\'stateCode\' AS "stateCode" FROM memberships m JOIN businesses b ON b.id=m.business_id WHERE m.user_id=$1 AND m.active=true ORDER BY b.name',
    [userId],
  );
  return rows;
}
export async function createBusiness(input, actorId = null) {
  return transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.id]);
    const old = (
      await db.query(
        'SELECT id,name,document_mode AS "documentMode" FROM businesses WHERE id=$1',
        [input.id],
      )
    ).rows[0];
    if (old) {
      if (
        old.name !== input.name ||
        (input.documentMode !== undefined &&
          old.documentMode !== input.documentMode)
      )
        throw Object.assign(Error("Business ID already used"), { status: 409 });
      return old;
    }
    if (!["composition", "regular_gst"].includes(input.documentMode))
      throw Object.assign(
        Error("Choose composition or regular GST document mode"),
        { status: 400 },
      );
    await db.query(
      "INSERT INTO businesses(id,name,document_mode) VALUES ($1,$2,$3)",
      [input.id, input.name, input.documentMode],
    );
    if (actorId)
      await db.query(
        "INSERT INTO audit_events(actor_id,business_id,action,entity_id) VALUES ($1,$2,'business.created',$2)",
        [actorId, input.id],
      );
    return input;
  });
}
export async function createUser(input, actorId = null) {
  return transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.id]);
    const old = (
      await db.query("SELECT id,email,password_hash FROM users WHERE id=$1", [
        input.id,
      ])
    ).rows[0];
    if (old) {
      if (
        old.email.toLowerCase() !== input.email.toLowerCase() ||
        !(await verifyPassword(input.password, old.password_hash))
      )
        throw Object.assign(Error("Account ID already used"), { status: 409 });
      return { id: old.id, email: old.email };
    }
    await db.query(
      "INSERT INTO users(id,email,password_hash) VALUES ($1,lower($2),$3)",
      [input.id, input.email, await hashPassword(input.password)],
    );
    if (actorId)
      await db.query(
        "INSERT INTO audit_events(actor_id,action,entity_id) VALUES ($1,'user.created',$2)",
        [actorId, input.id],
      );
    return { id: input.id, email: input.email.toLowerCase() };
  });
}
export async function createMembership(input, actorId) {
  return transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      input.userId,
    ]);
    const user = (
      await db.query("SELECT active FROM users WHERE id=$1 FOR UPDATE", [
        input.userId,
      ])
    ).rows[0];
    if (!user?.active)
      throw Object.assign(Error("Active account required"), { status: 409 });
    const old = (
      await db.query(
        "SELECT role,active FROM memberships WHERE user_id=$1 AND business_id=$2 FOR UPDATE",
        [input.userId, input.businessId],
      )
    ).rows[0];
    if (old?.role !== undefined && old.role !== input.role)
      throw Object.assign(
        Error("This account has a different retained role for this business"),
        { status: 409 },
      );
    if (old?.active) return input;
    const roles = (
      await db.query(
        "SELECT role FROM memberships WHERE user_id=$1 AND active=true FOR UPDATE",
        [input.userId],
      )
    ).rows;
    if (
      roles.some((r) => r.role !== input.role) ||
      (input.role === "staff" && roles.length > 0)
    )
      throw Object.assign(
        Error(
          "An owner can own several businesses; staff can have one active business and roles cannot be mixed",
        ),
        { status: 409 },
      );
    await db.query(
      "INSERT INTO memberships(user_id,business_id,role) VALUES ($1,$2,$3) ON CONFLICT(user_id,business_id) DO UPDATE SET active=true",
      [input.userId, input.businessId, input.role],
    );
    await db.query(
      "INSERT INTO audit_events(business_id,actor_id,action,entity_id) VALUES ($1,$2,$3,$4)",
      [
        input.businessId,
        actorId,
        old ? "membership.reactivated" : "membership.created",
        input.userId,
      ],
    );
    return input;
  });
}
export async function deactivateMembership(businessId, userId, actorId) {
  return transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [businessId]);
    await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    const current = await db.query(
      "SELECT role FROM memberships WHERE business_id=$1 AND user_id=$2 AND active=true FOR UPDATE",
      [businessId, userId],
    );
    if (!current.rowCount)
      throw Object.assign(new Error("Membership unavailable"), { status: 404 });
    if (current.rows[0].role === "owner") {
      const others = await db.query(
        "SELECT COUNT(*)::integer count FROM memberships WHERE business_id=$1 AND role='owner' AND active=true AND user_id<>$2",
        [businessId, userId],
      );
      if (others.rows[0].count === 0)
        throw Object.assign(new Error("Business needs an active owner"), {
          status: 409,
        });
    }
    await db.query(
      "UPDATE memberships SET active=false WHERE business_id=$1 AND user_id=$2",
      [businessId, userId],
    );
    await db.query(
      "UPDATE refresh_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",
      [userId],
    );
    await db.query(
      "INSERT INTO audit_events(business_id,actor_id,action,entity_id) VALUES ($1,$2,$3,$4)",
      [businessId, actorId, "membership.deactivated", userId],
    );
    return { businessId, userId, active: false };
  });
}
export async function deactivateDevice(deviceId, actorId) {
  return transaction(async (db) => {
    const reference = (
      await db.query("SELECT user_id FROM devices WHERE id=$1", [deviceId])
    ).rows[0];
    if (!reference)
      throw Object.assign(new Error("Device unavailable"), { status: 404 });
    await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
      reference.user_id,
    ]);
    const device = await db.query(
      "UPDATE devices SET active=false,offline_expires_at=now() WHERE id=$1 AND active=true RETURNING user_id",
      [deviceId],
    );
    if (!device.rowCount)
      throw Object.assign(new Error("Device unavailable"), { status: 404 });
    await db.query(
      "UPDATE refresh_sessions SET revoked_at=now() WHERE device_id=$1 AND revoked_at IS NULL",
      [deviceId],
    );
    await db.query(
      "INSERT INTO audit_events(actor_id,action,entity_id) VALUES ($1,$2,$3)",
      [actorId, "device.deactivated", deviceId],
    );
    return { deviceId, active: false };
  });
}
