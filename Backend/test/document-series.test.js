import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../src/config.js";
import { saleFixture } from "./helpers/fixtures.js";
import { initializeDocumentSeries } from "../src/services/settings.js";
import { createBill } from "../src/services/billing.js";

if (
  process.env.APP_ENV !== "development" ||
  !new URL(process.env.DATABASE_URL).pathname.includes("_tdd_")
)
  throw new Error("Isolated development database required");
test("document series is explicitly seeded, retries once, and cannot renumber issued bills", async () => {
  try {
    const f = await saleFixture({ lastNumber: 200 });
    const bill = (
      await pool.query(
        "SELECT financial_year,invoice_number FROM bills WHERE business_id=$1",
        [f.business],
      )
    ).rows[0];
    assert.equal(bill.invoice_number, 201);
    await assert.rejects(
      initializeDocumentSeries(f.business, f.owner, {
        financialYear: bill.financial_year,
        lastNumber: 300,
        operationId: randomUUID(),
      }),
      /issued|configured/i,
    );
    await pool.query("DELETE FROM document_series WHERE business_id=$1", [
      f.business,
    ]);
    await assert.rejects(
      createBill(f.business, f.owner, "owner", {
        id: randomUUID(),
        customerId: f.customer,
        occurrenceAt: new Date().toISOString(),
        operationId: randomUUID(),
        lines: [
          {
            id: randomUUID(),
            itemId: f.item,
            unitId: f.box,
            catalogueVersion: 1,
            quantityMilli: 1000,
          },
        ],
        payments: [],
      }),
      /series.*confirm/i,
    );
    const empty = randomUUID();
    await pool.query(
      "INSERT INTO businesses(id,name) VALUES ($1,'New business')",
      [empty],
    );
    const input = {
      financialYear: bill.financial_year,
      lastNumber: 50,
      operationId: randomUUID(),
    };
    const first = await initializeDocumentSeries(empty, f.owner, input);
    assert.deepEqual(
      await initializeDocumentSeries(empty, f.owner, input),
      first,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT last_number FROM document_series WHERE business_id=$1",
          [empty],
        )
      ).rows[0].last_number,
      50,
    );
  } finally {
    await pool.end();
  }
});
