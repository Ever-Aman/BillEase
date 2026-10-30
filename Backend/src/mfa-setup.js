import { generateSecret } from "otplib";
import { pool, assertDatabaseEnvironment } from "./config.js";
import { encryptSecret } from "./utils/mfa.js";
await assertDatabaseEnvironment();
const email = process.env.MFA_USER_EMAIL;
if (!email) throw new Error("Set MFA_USER_EMAIL");
const user = await pool.query(
  "SELECT id FROM users WHERE lower(email)=lower($1)",
  [email],
);
if (!user.rowCount) throw new Error("User not found");
const secret = generateSecret();
await pool.query(
  "INSERT INTO mfa_enrolments(user_id,secret,active) VALUES ($1,$2,true) ON CONFLICT (user_id) DO UPDATE SET secret=$2,active=true,last_step=NULL",
  [user.rows[0].id, encryptSecret(secret)],
);
console.log(
  "Add this secret to an authenticator app and store it safely. It is shown once:",
  secret,
);
await pool.end();
