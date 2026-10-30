import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { pool } from "../src/config.js";
import { saleFixture } from "./helpers/fixtures.js";
import { refreshSession } from "../src/services/accounts.js";

if (
  process.env.APP_ENV !== "development" ||
  !new URL(process.env.DATABASE_URL).pathname.includes("_tdd_")
)
  throw new Error("Isolated development database required");
test("invalid refresh secret cannot revoke a session; replay of a real rotated token revokes its device", async () => {
  try {
    const f = await saleFixture();
    const device = randomUUID(),
      id = randomUUID();
    const token = `${id}.${randomBytes(32).toString("base64url")}`;
    await pool.query(
      "INSERT INTO devices(id,user_id,name) VALUES ($1,$2,'Phone')",
      [device, f.owner],
    );
    await pool.query(
      "INSERT INTO refresh_sessions(id,device_id,user_id,token_hash,expires_at) VALUES ($1,$2,$3,$4,now()+interval '1 day')",
      [id, device, f.owner, createHash("sha256").update(token).digest("hex")],
    );
    await assert.rejects(
      refreshSession(`${id}.${randomBytes(32).toString("base64url")}`),
      /invalid|refresh/i,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT revoked_at FROM refresh_sessions WHERE id=$1",
          [id],
        )
      ).rows[0].revoked_at,
      null,
    );
    const next = await refreshSession(token);
    assert.ok(next.accessToken);
    await assert.rejects(refreshSession(token), /reused/i);
    await assert.rejects(refreshSession(next.refreshToken), /reused/i);
  } finally {
    await pool.end();
  }
});
