import { randomBytes, createHash } from "node:crypto";
import { generateSecret, verify } from "otplib";
import { pool, transaction } from "../config.js";
import { verifyPassword } from "../auth.js";
import { encryptSecret, decryptSecret, verifyMfa } from "../utils/mfa.js";

function fail(message, status = 401) {
  throw Object.assign(new Error(message), { status });
}
async function eligibleUser(db, userId) {
  const user = (
    await db.query(
      "SELECT u.id,u.email,u.password_hash,u.is_admin,EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.role='owner' AND m.active) owner FROM users u WHERE u.id=$1 AND u.active FOR UPDATE OF u",
      [userId],
    )
  ).rows[0];
  if (!user || (!user.is_admin && !user.owner))
    fail("MFA management requires an owner or admin", 403);
  return user;
}
async function passwordProof(user, password) {
  if (!(await verifyPassword(password, user.password_hash)))
    fail("Invalid credentials");
}
async function secondFactor(db, userId, proof) {
  const active = (
    await db.query("SELECT 1 FROM mfa_enrolments WHERE user_id=$1 AND active", [
      userId,
    ])
  ).rowCount;
  if (!active) fail("MFA is not active", 409);
  let valid = proof.mfaCode
    ? await verifyMfa(db, userId, proof.mfaCode)
    : false;
  if (!valid && proof.recoveryCode) {
    valid =
      (
        await db.query(
          "UPDATE recovery_codes SET used_at=now() WHERE user_id=$1 AND code_hash=$2 AND used_at IS NULL RETURNING code_hash",
          [
            userId,
            createHash("sha256").update(proof.recoveryCode).digest("hex"),
          ],
        )
      ).rowCount > 0;
  }
  if (!valid) fail("Fresh MFA proof required");
}
async function newRecoveryCodes(db, userId) {
  const codes = Array.from({ length: 10 }, () =>
    randomBytes(16).toString("hex"),
  );
  await db.query("DELETE FROM recovery_codes WHERE user_id=$1", [userId]);
  for (const code of codes)
    await db.query(
      "INSERT INTO recovery_codes(user_id,code_hash) VALUES ($1,$2)",
      [userId, createHash("sha256").update(code).digest("hex")],
    );
  return codes;
}
const audit = (db, userId, action) =>
  db.query(
    "INSERT INTO audit_events(actor_id,action,entity_id) VALUES ($1,$2,$1)",
    [userId, action],
  );

export async function mfaStatus(userId) {
  const { rows } = await pool.query(
    "SELECT EXISTS(SELECT 1 FROM mfa_enrolments WHERE user_id=$1 AND active) active,EXISTS(SELECT 1 FROM pending_mfa_enrolments WHERE user_id=$1 AND expires_at>now()) pending",
    [userId],
  );
  return rows[0];
}
export async function beginMfa(userId, input) {
  return transaction(async (db) => {
    const user = await eligibleUser(db, userId);
    await passwordProof(user, input.password);
    if (
      (
        await db.query(
          "SELECT 1 FROM mfa_enrolments WHERE user_id=$1 AND active",
          [userId],
        )
      ).rowCount
    )
      fail("MFA is already active", 409);
    const secret = generateSecret();
    const expiry = (
      await db.query(
        "INSERT INTO pending_mfa_enrolments(user_id,secret,expires_at) VALUES ($1,$2,now()+interval '10 minutes') ON CONFLICT(user_id) DO UPDATE SET secret=$2,expires_at=now()+interval '10 minutes',created_at=now() RETURNING expires_at",
        [userId, encryptSecret(secret)],
      )
    ).rows[0].expires_at;
    await audit(db, userId, "mfa.setup_started");
    return {
      secret,
      expiresAt: expiry,
      otpauthUri: `otpauth://totp/${encodeURIComponent(`BillEase:${user.email}`)}?secret=${encodeURIComponent(secret)}&issuer=BillEase&algorithm=SHA1&digits=6&period=30`,
    };
  });
}
export async function confirmMfa(userId, input, sessionId = null) {
  return transaction(async (db) => {
    await eligibleUser(db, userId);
    const pending = (
      await db.query(
        "SELECT secret FROM pending_mfa_enrolments WHERE user_id=$1 AND expires_at>now() FOR UPDATE",
        [userId],
      )
    ).rows[0];
    if (!pending) fail("MFA setup expired or unavailable", 409);
    if (
      (
        await db.query(
          "SELECT 1 FROM mfa_enrolments WHERE user_id=$1 AND active",
          [userId],
        )
      ).rowCount
    )
      fail("MFA is already active", 409);
    const result = await verify({
      secret: decryptSecret(pending.secret),
      token: input.code,
      epochTolerance: 30,
    });
    if (!result.valid) fail("Invalid MFA code");
    await db.query(
      "INSERT INTO mfa_enrolments(user_id,secret,active,last_step) VALUES ($1,$2,true,$3) ON CONFLICT(user_id) DO UPDATE SET secret=$2,active=true,last_step=$3",
      [userId, pending.secret, result.timeStep],
    );
    await db.query("DELETE FROM pending_mfa_enrolments WHERE user_id=$1", [
      userId,
    ]);
    await db.query(
      "UPDATE refresh_sessions SET revoked_at=now() WHERE user_id=$1 AND id IS DISTINCT FROM $2::uuid AND revoked_at IS NULL",
      [userId, sessionId],
    );
    const recoveryCodes = await newRecoveryCodes(db, userId);
    await audit(db, userId, "mfa.enabled");
    return { active: true, recoveryCodes };
  });
}
export async function rotateRecoveryCodes(userId, proof) {
  return transaction(async (db) => {
    const user = await eligibleUser(db, userId);
    await passwordProof(user, proof.password);
    await secondFactor(db, userId, proof);
    const recoveryCodes = await newRecoveryCodes(db, userId);
    await audit(db, userId, "mfa.recovery_codes_rotated");
    return { recoveryCodes };
  });
}
export async function disableMfa(userId, sessionId, proof) {
  return transaction(async (db) => {
    const user = await eligibleUser(db, userId);
    if (user.is_admin)
      fail("Admin MFA cannot be disabled through the app", 403);
    await passwordProof(user, proof.password);
    await secondFactor(db, userId, proof);
    await db.query("DELETE FROM mfa_enrolments WHERE user_id=$1", [userId]);
    await db.query("DELETE FROM pending_mfa_enrolments WHERE user_id=$1", [
      userId,
    ]);
    await db.query("DELETE FROM recovery_codes WHERE user_id=$1", [userId]);
    await db.query(
      "UPDATE refresh_sessions SET revoked_at=now() WHERE user_id=$1 AND id<>$2 AND revoked_at IS NULL",
      [userId, sessionId],
    );
    await audit(db, userId, "mfa.disabled");
    return { active: false };
  });
}
