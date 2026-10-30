import { createHmac } from "node:crypto";
import { jwtKey, pool } from "../config.js";

function key(category, identity) {
  return createHmac("sha256", jwtKey)
    .update(`${category}:${identity}`)
    .digest("hex");
}

async function check(
  category,
  identity,
  ip,
  maxIdentity,
  maxIp,
  windowSeconds,
) {
  const identityKey = key(`${category}:identity`, identity);
  const ipKey = key(`${category}:ip`, ip);
  const { rows } = await pool.query(
    `INSERT INTO request_limits(key_hash,hits)
     SELECT unnest($1::text[]),1
     ON CONFLICT(key_hash) DO UPDATE SET
       hits=CASE WHEN request_limits.window_started_at < now()-($2::integer * interval '1 second') THEN 1 ELSE request_limits.hits+1 END,
       window_started_at=CASE WHEN request_limits.window_started_at < now()-($2::integer * interval '1 second') THEN now() ELSE request_limits.window_started_at END
     RETURNING key_hash,hits`,
    [[identityKey, ipKey], windowSeconds],
  );
  const counts = new Map(rows.map((row) => [row.key_hash, row.hits]));
  return counts.get(identityKey) <= maxIdentity && counts.get(ipKey) <= maxIp;
}

function category(req, publicRoute) {
  if (publicRoute) {
    if (req.path === "/auth/login") return ["login", 20, 300, 900];
    if (req.path === "/auth/refresh") return ["refresh", 90, 600, 900];
    if (req.path === "/recovery/upload") return ["recovery", 30, 300, 900];
    return null;
  }
  if (req.method === "GET" && req.path.endsWith("/sync"))
    return ["sync", 180, 1200, 60];
  if (req.path.startsWith("/me/mfa/") && req.method !== "GET")
    return ["mfa", 20, 300, 900];
  if (req.method === "GET" && req.path.endsWith("/pdf"))
    return ["pdf", 30, 300, 60];
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method))
    return ["mutation", 120, 1000, 60];
  return null;
}

export function rateLimit(publicRoute = false) {
  return async (req, res, next) => {
    try {
      const rule = category(req, publicRoute);
      if (!rule) return next();
      const [name, perIdentity, perIp, seconds] = rule;
      const identity = publicRoute
        ? req.path === "/auth/login"
          ? String(req.body?.email || "")
              .trim()
              .toLowerCase()
              .slice(0, 254)
          : req.path === "/recovery/upload"
            ? String(req.body?.deviceId || "").slice(0, 64)
            : String(req.body?.refreshToken || "").slice(0, 36)
        : req.user.id;
      const allowed = await check(
        name,
        identity,
        req.ip || req.socket.remoteAddress || "unknown",
        perIdentity,
        perIp,
        seconds,
      );
      if (!allowed) {
        res.set("Retry-After", String(seconds));
        return res
          .status(429)
          .json({ error: "Too many requests; try again later" });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function startRateLimitCleanup() {
  const cleanup = () =>
    pool
      .query(
        "DELETE FROM request_limits WHERE window_started_at < now()-interval '1 day'",
      )
      .catch((error) =>
        console.error("Rate-limit cleanup failed:", error.message),
      );
  cleanup();
  const timer = setInterval(cleanup, 24 * 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
