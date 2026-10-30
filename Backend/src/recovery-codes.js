import { randomBytes, createHash } from "node:crypto";
import { pool, assertDatabaseEnvironment, transaction } from "./config.js";
await assertDatabaseEnvironment();
const email = process.env.RECOVERY_USER_EMAIL;
if (!email) throw new Error("Set RECOVERY_USER_EMAIL");
const user = await pool.query(
  "SELECT id FROM users WHERE lower(email)=lower($1)",
  [email],
);
if (!user.rowCount) throw new Error("User not found");
const codes = Array.from({ length: 10 }, () => randomBytes(16).toString("hex"));
await transaction(async (db) => {
  await db.query("DELETE FROM recovery_codes WHERE user_id=$1", [
    user.rows[0].id,
  ]);
  for (const code of codes)
    await db.query(
      "INSERT INTO recovery_codes(user_id,code_hash) VALUES ($1,$2)",
      [user.rows[0].id, createHash("sha256").update(code).digest("hex")],
    );
});
console.log(
  "Store these one-time recovery codes securely; they are shown once:",
);
for (const code of codes) console.log(code);
await pool.end();
