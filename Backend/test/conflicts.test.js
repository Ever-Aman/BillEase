import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/config.js";
import { errorHandler } from "../src/utils/errors.js";
import { resolveSyncConflict } from "../src/services/conflicts.js";

if (
  process.env.APP_ENV !== "development" ||
  !new URL(process.env.DATABASE_URL).pathname.includes("_tdd_")
)
  throw new Error(
    "Conflict test requires an isolated development _tdd_ database",
  );

test("distinct offline version conflicts remain visible for owner review", async () => {
  const business = "33333333-3333-4333-8333-333333333333";
  const staff = "22222222-2222-4222-8222-222222222222";
  try {
    await pool.query(
      "INSERT INTO users(id,email,password_hash) VALUES ($1,'staff@example.com','x')",
      [staff],
    );
    await pool.query("INSERT INTO businesses(id,name) VALUES ($1,'Test')", [
      business,
    ]);
    const responses = [];
    for (const operationId of [
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
    ]) {
      const req = {
        method: "PUT",
        originalUrl: `/v1/businesses/${business}/catalogue/items/66666666-6666-4666-8666-666666666666`,
        user: { id: staff },
        body: { operationId, expectedVersion: 1 },
      };
      const res = {
        statusCode: 200,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(value) {
          responses.push({ status: this.statusCode, value });
          return this;
        },
      };
      await errorHandler(
        Object.assign(new Error("Item version conflict"), { status: 409 }),
        req,
        res,
        () => {},
      );
    }
    assert.equal(responses[0].value.outcome, "review_required");
    const { rows } = await pool.query(
      "SELECT id,operation_id FROM sync_conflicts WHERE business_id=$1 ORDER BY operation_id",
      [business],
    );
    assert.equal(rows.length, 2);
    const decision = {
      id: rows[0].id,
      resolution: "discarded",
      note: "Obsolete offline edit",
      operationId: "77777777-7777-4777-8777-777777777777",
    };
    const first = await resolveSyncConflict(business, staff, decision);
    const replay = await resolveSyncConflict(business, staff, decision);
    assert.deepEqual(replay, first);
    const { guardConflictOperation } =
      await import("../src/services/conflicts.js");
    assert.equal(typeof guardConflictOperation, "function");
    const attempt = {
      method: "PUT",
      originalUrl: `/v1/businesses/${business}/catalogue/items/66666666-6666-4666-8666-666666666666`,
      user: { id: staff },
      body: { operationId: rows[0].operation_id, expectedVersion: 2 },
    };
    let status = 0;
    await guardConflictOperation(
      attempt,
      {
        status(code) {
          status = code;
          return this;
        },
        json() {
          return this;
        },
      },
      () => {},
    );
    assert.equal(status, 409);
  } finally {
    await pool.end();
  }
});
