import { randomUUID } from "node:crypto";
import { pool, assertDatabaseEnvironment } from "./config.js";
import { hashPassword } from "./auth.js";

await assertDatabaseEnvironment();
const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
if (!email || !password || password.length < 12)
  throw new Error(
    "Set BOOTSTRAP_ADMIN_EMAIL and a password of at least 12 characters",
  );
const result = await pool.query(
  "INSERT INTO users(id,email,password_hash,is_admin) VALUES ($1,lower($2),$3,true) ON CONFLICT (email) DO NOTHING RETURNING id",
  [randomUUID(), email, await hashPassword(password)],
);
console.log(result.rowCount ? "Admin created" : "Admin already exists");
await pool.end();
