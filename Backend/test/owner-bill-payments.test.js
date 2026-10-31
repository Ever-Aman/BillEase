import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../src/config.js";
import { saleFixture } from "./helpers/fixtures.js";
import { createBill, getBill, decidePayment } from "../src/services/billing.js";
import { deliveryView } from "../src/services/delivery.js";
import { overview } from "../src/services/reports.js";

if (
  process.env.APP_ENV !== "development" ||
  !new URL(process.env.DATABASE_URL).pathname.includes("_tdd_")
)
  throw new Error("Isolated development database required");
after(() => pool.end());

function billInput(f, payments, customerId = f.customer) {
  return {
    id: randomUUID(),
    customerId,
    occurrenceAt: new Date().toISOString(),
    operationId: randomUUID(),
    lines: [
      {
        id: randomUUID(),
        itemId: f.item,
        unitId: f.box,
        catalogueVersion: 1,
        quantityMilli: 2000,
      },
    ],
    payments: payments.map(([method, amountMinor]) => ({
      id: randomUUID(),
      method,
      amountMinor,
    })),
  };
}

for (const method of ["cash", "upi", "bank"]) {
  test(`owner ${method} receipt confirms immediately, settles debt and authorizes delivery`, async () => {
    const f = await saleFixture();
    const input = billInput(f, [[method, 2000]]);
    const result = await createBill(f.business, f.owner, "owner", input);
    assert.equal(result.reviewState, "not_required");
    const bill = await getBill(f.business, input.id, f.owner, "owner");
    assert.equal(bill.payments[0].state, "confirmed");
    assert.equal(
      (
        await pool.query("SELECT verified_by FROM payments WHERE id=$1", [
          input.payments[0].id,
        ])
      ).rows[0].verified_by,
      f.owner,
    );
    const ledger = await pool.query(
      "SELECT debt_delta_minor::text debt,advance_delta_minor::text advance FROM customer_ledger WHERE payment_id=$1",
      [input.payments[0].id],
    );
    assert.deepEqual(ledger.rows, [{ debt: "-2000", advance: "0" }]);
    const view = await deliveryView(f.business, input.id);
    assert.equal(
      Number(view.authorization.lines[0].permittedAdditionalCanonical),
      20,
    );
    const report = await overview(
      f.business,
      "2000-01-01T00:00:00Z",
      "2100-01-01T00:00:00Z",
    );
    assert.equal(
      report.confirmedReceipts.find((p) => p.method === method).amount_minor,
      "2000",
    );
    assert.equal(report.unverifiedClaims.length, 0);
    assert.deepEqual(
      await createBill(f.business, f.owner, "owner", input),
      result,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int count FROM customer_ledger WHERE payment_id=$1",
          [input.payments[0].id],
        )
      ).rows[0].count,
      1,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int count FROM push_jobs WHERE business_id=$1",
          [f.business],
        )
      ).rows[0].count,
      0,
    );
  });
}

for (const payments of [
  [["upi", 2000]],
  [["bank", 2000]],
  [
    ["cash", 500],
    ["upi", 800],
    ["bank", 700],
  ],
]) {
  test(`owner walk-in accepts full payment via ${payments.map(([method]) => method).join("/")}`, async () => {
    const f = await saleFixture();
    const input = billInput(f, payments, null);
    await createBill(f.business, f.owner, "owner", input);
    const bill = await getBill(f.business, input.id, f.owner, "owner");
    assert.ok(bill.payments.every((p) => p.state === "confirmed"));
    assert.equal(bill.bill.review_state, "not_required");
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int count FROM customer_ledger WHERE bill_id=$1",
          [input.id],
        )
      ).rows[0].count,
      0,
    );
  });
}

test("owner mixed overpayment allocates existing debt before customer advance", async () => {
  const f = await saleFixture({ cash: 2000, priorDebt: 1000 });
  const input = billInput(f, [
    ["cash", 500],
    ["upi", 1500],
    ["bank", 1500],
  ]);
  await createBill(f.business, f.owner, "owner", input);
  const balance = await pool.query(
    "SELECT sum(debt_delta_minor)::text debt,sum(advance_delta_minor)::text advance FROM customer_ledger WHERE business_id=$1 AND customer_id=$2",
    [f.business, f.customer],
  );
  assert.deepEqual(balance.rows[0], { debt: "0", advance: "500" });
});

test("staff digital claims remain pending until owner verification and only cash covers delivery", async () => {
  const f = await saleFixture();
  const input = billInput(f, [
    ["cash", 500],
    ["upi", 800],
    ["bank", 700],
  ]);
  const result = await createBill(f.business, f.staff, "staff", input);
  assert.equal(result.reviewState, "credit_pending");
  const bill = await getBill(f.business, input.id, f.staff, "staff");
  assert.deepEqual(
    Object.fromEntries(bill.payments.map((p) => [p.method, p.state])),
    { cash: "confirmed", upi: "pending", bank: "pending" },
  );
  const view = await deliveryView(f.business, input.id);
  assert.equal(
    Number(view.authorization.lines[0].permittedAdditionalCanonical),
    5,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int count FROM push_jobs WHERE reference_id=$1 AND category='bill_review'",
        [input.id],
      )
    ).rows[0].count,
    1,
  );
  for (const payment of input.payments.filter((p) => p.method !== "cash")) {
    await decidePayment(f.business, f.owner, {
      paymentId: payment.id,
      confirm: true,
      operationId: randomUUID(),
    });
  }
  const verified = await deliveryView(f.business, input.id);
  assert.equal(
    Number(verified.authorization.lines[0].permittedAdditionalCanonical),
    20,
  );
});

test("walk-in shortfall and overpayment remain rejected and staff cannot use digital walk-in claims", async () => {
  const f = await saleFixture();
  for (const [role, payments] of [
    ["owner", [["upi", 1999]]],
    ["owner", [["bank", 2001]]],
    ["staff", [["upi", 2000]]],
    [
      "staff",
      [
        ["cash", 500],
        ["bank", 1500],
      ],
    ],
  ]) {
    await assert.rejects(
      createBill(f.business, f[role], role, billInput(f, payments, null)),
      /Walk-in bill requires confirmed payment|Payment exceeds/,
    );
  }
  await assert.rejects(
    createBill(f.business, f.staff, "staff", billInput(f, [["cash", 2001]])),
    /Payment exceeds/,
  );
});
