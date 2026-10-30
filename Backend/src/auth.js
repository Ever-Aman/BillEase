import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { SignJWT, jwtVerify } from "jose";
import { jwtKey, pool } from "./config.js";
import { requestContext } from "./utils/request-context.js";

const scrypt = promisify(scryptCallback);
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}
export async function verifyPassword(password, encoded) {
  const [algorithm, saltHex, hashHex] = encoded.split(":");
  if (algorithm !== "scrypt" || !saltHex || !hashHex) return false;
  const saved = Buffer.from(hashHex, "hex");
  const actual = await scrypt(
    password,
    Buffer.from(saltHex, "hex"),
    saved.length,
  );
  return timingSafeEqual(saved, actual);
}
export async function issueToken(user, sessionId) {
  return new SignJWT({ sid: sessionId, purpose: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer("billease")
    .setAudience("billease-api")
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(jwtKey);
}
export async function authenticate(req, res, next) {
  try {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token)
      return res.status(401).json({ error: "Authentication required" });
    const { payload } = await jwtVerify(token, jwtKey, {
      issuer: "billease",
      audience: "billease-api",
      algorithms: ["HS256"],
    });
    if (payload.purpose !== "access" || typeof payload.sid !== "string")
      return res.status(401).json({ error: "Authentication required" });
    const { rows } = await pool.query(
      "SELECT u.id,u.email,u.is_admin,u.active,d.id device_id FROM users u JOIN refresh_sessions s ON s.user_id=u.id JOIN devices d ON d.id=s.device_id WHERE u.id=$1 AND s.id=$2 AND s.revoked_at IS NULL AND s.expires_at>now() AND d.active=true",
      [payload.sub, payload.sid],
    );
    if (!rows[0]?.active)
      return res.status(401).json({ error: "Authentication required" });
    req.user = rows[0];
    req.sessionId = payload.sid;
    requestContext.run(
      { deviceId: rows[0].device_id, sessionId: payload.sid },
      next,
    );
  } catch {
    res.status(401).json({ error: "Authentication required" });
  }
}
export async function membership(req, res, next) {
  const { rows } = await pool.query(
    "SELECT role FROM memberships WHERE user_id=$1 AND business_id=$2 AND active=true",
    [req.user.id, req.params.businessId],
  );
  if (!rows[0])
    return res.status(403).json({ error: "Business access denied" });
  req.role = rows[0].role;
  next();
}
export function owner(req, res, next) {
  if (req.role !== "owner")
    return res.status(403).json({ error: "Owner access required" });
  next();
}
export function admin(req, res, next) {
  if (!req.user.is_admin)
    return res.status(403).json({ error: "Admin access required" });
  next();
}
