import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../src/config.js";
import { saleFixture } from "./helpers/fixtures.js";
import { recordDelivery, deliveryView } from "../src/services/delivery.js";
import { recordReturn } from "../src/services/returns.js";
import { cancelBill } from "../src/services/cancellation.js";
import { correctDelivery } from "../src/services/corrections.js";

if (
  process.env.APP_ENV !== "development" ||
  !new URL(process.env.DATABASE_URL).pathname.includes("_tdd_")
)
  throw new Error("Isolated development database required");

test("mixed-unit return and partial cancellation keep original value and quantity limits", async () => {
  try {
    const f = await saleFixture();
    const deliveryId = randomUUID();
    await recordDelivery(f.business, f.owner, "owner", {
      id: deliveryId,
      billId: f.bill,
      lineId: f.line,
      unitId: f.piece,
      quantityMilli: 6000,
      occurrenceAt: new Date().toISOString(),
      operationId: randomUUID(),
    });
    const returned = await recordReturn(f.business, f.owner, {
      id: randomUUID(),
      billId: f.bill,
      lineId: f.line,
      unitId: f.piece,
      quantityMilli: 3000,
      disposition: "restockable",
      resolution: "advance",
      reason: "Returned 3 pieces",
      operationId: randomUUID(),
    });
    assert.equal(returned.valueMinor, "300");
    const cancel = {
      billId: f.bill,
      lines: [{ lineId: f.line, unitId: f.piece, quantityMilli: 14000 }],
      resolution: "advance",
      reason: "Cancel undelivered 14 pieces",
      operationId: randomUUID(),
    };
    const result = await cancelBill(f.business, f.owner, cancel);
    assert.equal(result.valueMinor, "1400");
    assert.equal(result.lifecycle, "issued");
    assert.deepEqual(await cancelBill(f.business, f.owner, cancel), result);
    await assert.rejects(
      cancelBill(f.business, f.owner, {
        ...cancel,
        lines: [{ lineId: f.line, unitId: f.piece, quantityMilli: 1000 }],
        operationId: randomUUID(),
      }),
      /undelivered|quantity/i,
    );
    const view = await deliveryView(f.business, f.bill);
    assert.equal(Number(view.lines[0].pending_canonical), 0);
    assert.equal(Number(view.lines[0].returned_canonical), 3);
    const balance = await pool.query(
      "SELECT SUM(debt_delta_minor)::text debt FROM customer_ledger WHERE business_id=$1",
      [f.business],
    );
    assert.equal(balance.rows[0].debt, "300");
    await assert.rejects(
      correctDelivery(f.business, f.owner, {
        id: randomUUID(),
        deliveryId,
        reason: "Cannot erase goods already returned",
        operationId: randomUUID(),
      }),
      /returned/i,
    );

    const paid = await saleFixture({ cash: 500 });
    const paidCancel = {
      billId: paid.bill,
      reason: "Cancel before handover",
      operationId: randomUUID(),
    };
    await assert.rejects(
      cancelBill(paid.business, paid.owner, paidCancel),
      /refund or advance/i,
    );
    const cancelled = await cancelBill(paid.business, paid.owner, {
      ...paidCancel,
      resolution: "advance",
    });
    assert.equal(cancelled.lifecycle, "cancelled");
    assert.equal(cancelled.debtReducedMinor, "1500");
    assert.equal(cancelled.excessMinor, "500");
    const paidBalance = (
      await pool.query(
        "SELECT SUM(debt_delta_minor)::text debt,SUM(advance_delta_minor)::text advance FROM customer_ledger WHERE business_id=$1",
        [paid.business],
      )
    ).rows[0];
    assert.deepEqual(paidBalance, { debt: "0", advance: "500" });

    const concurrent = await saleFixture({ quantityMilli: 1000 });
    await recordDelivery(concurrent.business, concurrent.owner, "owner", {
      id: randomUUID(),
      billId: concurrent.bill,
      lineId: concurrent.line,
      unitId: concurrent.piece,
      quantityMilli: 10000,
      occurrenceAt: new Date().toISOString(),
      operationId: randomUUID(),
    });
    const attempts = await Promise.allSettled(
      [1, 2].map(() =>
        recordReturn(concurrent.business, concurrent.owner, {
          id: randomUUID(),
          billId: concurrent.bill,
          lineId: concurrent.line,
          unitId: concurrent.piece,
          quantityMilli: 6000,
          disposition: "restockable",
          resolution: "advance",
          reason: "Concurrent request",
          operationId: randomUUID(),
        }),
      ),
    );
    assert.equal(attempts.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(attempts.filter((x) => x.status === "rejected").length, 1);
    const claimed = await saleFixture({ digital: 2000, role: "staff" });
    await cancelBill(claimed.business, claimed.owner, {
      billId: claimed.bill,
      reason: "Cancel sale; keep receipt claim for verification",
      operationId: randomUUID(),
    });
    assert.equal(
      (
        await pool.query("SELECT state FROM payments WHERE business_id=$1", [
          claimed.business,
        ])
      ).rows[0].state,
      "pending",
    );
  } finally {
    await pool.end();
  }
});
