import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../src/config.js";
import { saleFixture } from "./helpers/fixtures.js";
import {
  openingBalance,
  recordRepayment,
  getBalance,
  applyAdvance,
} from "../src/services/finance.js";
import { correctLedgerEntry } from "../src/services/ledger-corrections.js";
import { overview } from "../src/services/reports.js";
import { cancelBill } from "../src/services/cancellation.js";

if (
  process.env.APP_ENV !== "development" ||
  !new URL(process.env.DATABASE_URL).pathname.includes("_tdd_")
)
  throw new Error("Isolated development database required");
test("opening and standalone cash corrections preserve entries and prevent spending advance twice", async () => {
  try {
    const f = await saleFixture();
    const opening = await openingBalance(f.business, f.owner, {
      customerId: f.customer,
      kind: "debt",
      amountMinor: 500,
      note: "Opening",
      occurrenceAt: "2026-04-01T00:00:00Z",
      operationId: randomUUID(),
    });
    assert.equal(
      (
        await pool.query(
          "SELECT occurrence_at FROM customer_ledger WHERE id=$1",
          [opening.entryId],
        )
      ).rows[0].occurrence_at.toISOString(),
      "2026-04-01T00:00:00.000Z",
    );
    const correction = {
      entryId: opening.entryId,
      reason: "Opening should be 300",
      replacement: { amountMinor: 300, openingKind: "debt" },
      operationId: randomUUID(),
    };
    await correctLedgerEntry(f.business, f.owner, correction);
    await correctLedgerEntry(f.business, f.owner, correction);
    assert.equal((await getBalance(f.business, f.customer)).debtMinor, "2300");
    const repayment = await recordRepayment(f.business, f.owner, {
      customerId: f.customer,
      amountMinor: 300,
      note: "Cash",
      operationId: randomUUID(),
    });
    await correctLedgerEntry(f.business, f.owner, {
      entryId: repayment.entryId,
      reason: "Cash was 200",
      replacement: { amountMinor: 200 },
      operationId: randomUUID(),
    });
    assert.equal((await getBalance(f.business, f.customer)).debtMinor, "2100");
    const advance = await openingBalance(f.business, f.owner, {
      customerId: f.customer,
      kind: "advance",
      amountMinor: 100,
      note: "Opening advance",
      operationId: randomUUID(),
    });
    await applyAdvance(f.business, f.owner, {
      customerId: f.customer,
      billId: f.bill,
      amountMinor: 50,
      operationId: randomUUID(),
    });
    await assert.rejects(
      correctLedgerEntry(f.business, f.owner, {
        entryId: advance.entryId,
        reason: "Cannot erase used advance",
        operationId: randomUUID(),
      }),
      /negative|already used|reconcile/i,
    );
    assert.equal((await getBalance(f.business, f.customer)).advanceMinor, "50");
    const report = await overview(
      f.business,
      "2000-01-01T00:00:00Z",
      "2100-01-01T00:00:00Z",
    );
    assert.equal(report.confirmedReceipts[0].amount_minor, "500");
    assert.equal(report.receiptReversals[0].amount_minor, "300");
    const adjusted = await saleFixture({ priorDebt: 1000 });
    await openingBalance(adjusted.business, adjusted.owner, {
      customerId: adjusted.customer,
      kind: "advance",
      amountMinor: 2000,
      note: "Advance",
      operationId: randomUUID(),
    });
    await cancelBill(adjusted.business, adjusted.owner, {
      billId: adjusted.bill,
      lines: [
        { lineId: adjusted.line, unitId: adjusted.piece, quantityMilli: 5000 },
      ],
      reason: "Reduce sale",
      operationId: randomUUID(),
    });
    await assert.rejects(
      applyAdvance(adjusted.business, adjusted.owner, {
        customerId: adjusted.customer,
        billId: adjusted.bill,
        amountMinor: 1600,
        operationId: randomUUID(),
      }),
      /bill due/i,
    );
  } finally {
    await pool.end();
  }
});
