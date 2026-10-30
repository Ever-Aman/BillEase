import { Pool } from "pg";
import { requestContext } from "./utils/request-context.js";

export const environment = process.env.APP_ENV;
if (!["development", "production"].includes(environment))
  throw new Error("APP_ENV must be development or production");
if (process.env.DATABASE_ENV !== environment)
  throw new Error("DATABASE_ENV must match APP_ENV");
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)
  throw new Error("JWT_SECRET must have at least 32 characters");
function validateDatabaseUrl(value, name) {
  const url = new URL(value);
  if (
    environment === "production" &&
    url.searchParams.get("sslmode") !== "require" &&
    url.searchParams.get("sslmode") !== "verify-full"
  )
    throw new Error(
      `Production ${name} must specify sslmode=require or verify-full`,
    );
}
validateDatabaseUrl(process.env.DATABASE_URL, "DATABASE_URL");
if (process.env.DATABASE_URL_POOLED)
  validateDatabaseUrl(process.env.DATABASE_URL_POOLED, "DATABASE_URL_POOLED");

const poolOptions = {
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  statement_timeout: 30000,
  lock_timeout: 5000,
  query_timeout: 35000,
};
export const directPool = new Pool({
  ...poolOptions,
  connectionString: process.env.DATABASE_URL,
});
export const pool = process.env.DATABASE_URL_POOLED
  ? new Pool({
      ...poolOptions,
      connectionString: process.env.DATABASE_URL_POOLED,
    })
  : directPool;
function reportIdleConnectionError(error) {
  console.error(
    "Idle database connection failed:",
    error.code || "database_error",
  );
}
pool.on("error", reportIdleConnectionError);
if (directPool !== pool) directPool.on("error", reportIdleConnectionError);
if (!/^[0-3]$/.test(process.env.TRUST_PROXY_HOPS ?? "0"))
  throw new Error("TRUST_PROXY_HOPS must be an integer from 0 to 3");
export const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? "0");
export const jwtKey = new TextEncoder().encode(process.env.JWT_SECRET);
if (!/^[0-9a-f]{64}$/i.test(process.env.MFA_ENCRYPTION_KEY || ""))
  throw new Error("MFA_ENCRYPTION_KEY must be 64 hex characters");
export const mfaKey = Buffer.from(process.env.MFA_ENCRYPTION_KEY, "hex");

export async function assertDatabaseEnvironment() {
  const { rows } = await pool.query(
    "select environment from deployment_identity where id = 1",
  );
  if (rows[0]?.environment !== environment)
    throw new Error("Database environment mismatch");
}

export async function transaction(fn, { readOnly = false } = {}) {
  const client = await pool.connect();
  try {
    await client.query(
      readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN",
    );
    const context = requestContext.getStore();
    if (context)
      await client.query(
        "SELECT set_config('billease.device_id',$1,true),set_config('billease.session_id',$2,true)",
        [context.deviceId, context.sessionId],
      );
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
