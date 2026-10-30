import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../src/config.js";
import { saleFixture } from "./helpers/fixtures.js";
import { recordRepayment } from "../src/services/finance.js";
import { getBill } from "../src/services/billing.js";
import { correctPayment } from "../src/services/corrections.js";
import { cancelBill } from "../src/services/cancellation.js";
import { overview } from "../src/services/reports.js";

if (
  process.env.APP_ENV !== "development" ||
  !new URL(process.env.DATABASE_URL).pathname.includes("_tdd_")
)
  throw new Error("Isolated development database required");
test("owner report includes repayment receipts, correction reversals and dated cancellation values", async () => {
  try {
    const f = await saleFixture({ cash: 500, digital: 1500 });
    await recordRepayment(f.business, f.owner, {
      customerId: f.customer,
      amountMinor: 100,
      note: "Repayment",
      operationId: randomUUID(),
    });
    const bill = await getBill(f.business, f.bill, f.owner, "owner");
    await correctPayment(f.business, f.owner, {
      id: randomUUID(),
      paymentId: bill.payments.find((x) => x.method === "cash").id,
      reason: "Correct cash amount",
      operationId: randomUUID(),
      replacement: {
        id: randomUUID(),
        method: "cash",
        amountMinor: 400,
        occurrenceAt: new Date().toISOString(),
      },
    });
    await cancelBill(f.business, f.owner, {
      billId: f.bill,
      lines: [{ lineId: f.line, unitId: f.piece, quantityMilli: 5000 }],
      reason: "Cancel five pieces",
      operationId: randomUUID(),
    });
    const report = await overview(
      f.business,
      "2000-01-01T00:00:00Z",
      "2100-01-01T00:00:00Z",
    );
    assert.equal(
      report.confirmedReceipts.find((x) => x.method === "cash").amount_minor,
      "1000",
    );
    assert.equal(
      report.receiptReversals.find((x) => x.method === "cash").amount_minor,
      "500",
    );
    assert.equal(report.cancellations.cancelled_value_minor, "500");
    assert.equal(report.unverifiedClaims[0].amount_minor, "1500");
    assert.equal(report.balances.debt_minor, "1000");
    assert.equal(report.fulfilment.pending_line_count, 1);
  } finally {
    await pool.end();
  }
});
