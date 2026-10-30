import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { mfaKey } from "../config.js";
import { verify } from "otplib";
export function encryptSecret(secret) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", mfaKey, iv);
  const body = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}
export function decryptSecret(encoded) {
  const data = Buffer.from(encoded, "base64"),
    decipher = createDecipheriv("aes-256-gcm", mfaKey, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([
    decipher.update(data.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}
export async function verifyMfa(db, userId, code) {
  const { rows } = await db.query(
    "SELECT secret,last_step FROM mfa_enrolments WHERE user_id=$1 AND active=true FOR UPDATE",
    [userId],
  );
  if (!rows[0]) return false;
  const result = await verify({
    secret: decryptSecret(rows[0].secret),
    token: code,
    epochTolerance: 30,
    afterTimeStep:
      rows[0].last_step === null ? undefined : Number(rows[0].last_step),
  });
  if (!result.valid) return false;
  await db.query("UPDATE mfa_enrolments SET last_step=$2 WHERE user_id=$1", [
    userId,
    result.timeStep,
  ]);
  return true;
}
