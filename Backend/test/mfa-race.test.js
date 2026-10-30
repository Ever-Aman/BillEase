import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { generate } from "otplib";
import { pool } from "../src/config.js";
import { hashPassword } from "../src/auth.js";
import { login } from "../src/services/accounts.js";
import { beginMfa, confirmMfa } from "../src/services/mfa-management.js";
import { saleFixture } from "./helpers/fixtures.js";

if (
  process.env.APP_ENV !== "development" ||
  !new URL(process.env.DATABASE_URL).pathname.includes("_tdd_")
)
  throw new Error("Isolated development database required");
async function until(check) {
  for (let i = 0; i < 150; i++) {
    if (await check()) return;
    await delay(10);
  }
  throw new Error("Concurrency barrier was not reached");
}
test("MFA enrollment cannot leave a concurrent password-only sign-in active", async () => {
  let blocker, attemptedLogin, confirming;
  try {
    const f = await saleFixture(),
      password = "strong-password-for-race-test";
    const email = (
      await pool.query(
        "UPDATE users SET password_hash=$2 WHERE id=$1 RETURNING email",
        [f.owner, await hashPassword(password)],
      )
    ).rows[0].email;
    const setup = await beginMfa(f.owner, { password });
    const key = generateKeyPairSync("ed25519")
      .publicKey.export({ type: "spki", format: "der" })
      .toString("base64");
    blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query("LOCK TABLE devices IN ACCESS EXCLUSIVE MODE");
    attemptedLogin = login(
      email,
      password,
      randomUUID(),
      "Concurrent phone",
      undefined,
      undefined,
      key,
    ).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    await until(
      async () =>
        (
          await pool.query(
            "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT user_id,active,public_key FROM devices%' ",
          )
        ).rowCount > 0,
    );
    let confirmationDone = false;
    confirming = confirmMfa(f.owner, {
      code: await generate({ secret: setup.secret }),
    })
      .then(
        (value) => ({ value }),
        (error) => ({ error }),
      )
      .finally(() => {
        confirmationDone = true;
      });
    await until(
      async () =>
        confirmationDone ||
        (
          await pool.query(
            "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FOR UPDATE OF u' ",
          )
        ).rowCount > 0,
    );
    await blocker.query("COMMIT");
    blocker.release();
    blocker = null;
    const [signedIn, enabled] = await Promise.all([attemptedLogin, confirming]);
    assert.equal(enabled.error, undefined);
    if (signedIn.value) {
      const id = signedIn.value.refreshToken.split(".")[0];
      assert.notEqual(
        (
          await pool.query(
            "SELECT revoked_at FROM refresh_sessions WHERE id=$1",
            [id],
          )
        ).rows[0].revoked_at,
        null,
      );
    } else assert.match(signedIn.error.message, /MFA/);
  } finally {
    if (blocker) {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    await Promise.all([attemptedLogin, confirming]);
    await pool.end();
  }
});
