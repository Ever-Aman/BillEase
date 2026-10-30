import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/config.js";
import { correctPayment } from "../src/services/corrections.js";

if (
  process.env.APP_ENV !== "development" ||
  !new URL(process.env.DATABASE_URL).pathname.includes("_tdd_")
)
  throw new Error(
    "Payment replacement test requires an isolated development _tdd_ database",
  );

test("a corrected cash payment is reversed and replaced in one ledger transaction", async () => {
  const business = "33333333-3333-4333-8333-333333333333";
  const owner = "11111111-1111-4111-8111-111111111111";
  const customer = "22222222-2222-4222-8222-222222222222";
  const bill = "44444444-4444-4444-8444-444444444444";
  const oldPayment = "55555555-5555-4555-8555-555555555555";
  const replacement = "66666666-6666-4666-8666-666666666666";
  try {
    await pool.query(
      "INSERT INTO users(id,email,password_hash) VALUES ($1,'owner@example.com','x')",
      [owner],
    );
    await pool.query("INSERT INTO businesses(id,name) VALUES ($1,'Test')", [
      business,
    ]);
    await pool.query(
      "INSERT INTO customers(id,business_id,name,phone,locality) VALUES ($1,$2,'Customer','1234567890','Here')",
      [customer, business],
    );
    await pool.query(
      "INSERT INTO bills(id,business_id,customer_id,actor_id,financial_year,invoice_number,total_minor,review_state,occurrence_at) VALUES ($1,$2,$3,$4,'2026-27',1,1000,'not_required',now())",
      [bill, business, customer, owner],
    );
    await pool.query(
      "INSERT INTO payments(id,business_id,bill_id,method,amount_minor,state,actor_id,occurrence_at) VALUES ($1,$2,$3,'cash',300,'confirmed',$4,now())",
      [oldPayment, business, bill, owner],
    );
    await pool.query(
      "INSERT INTO customer_ledger(business_id,customer_id,bill_id,debt_delta_minor,actor_id) VALUES ($1,$2,$3,1000,$4)",
      [business, customer, bill, owner],
    );
    await pool.query(
      "INSERT INTO customer_ledger(business_id,customer_id,bill_id,payment_id,debt_delta_minor,actor_id) VALUES ($1,$2,$3,$4,-300,$5)",
      [business, customer, bill, oldPayment, owner],
    );
    const result = await correctPayment(business, owner, {
      id: "77777777-7777-4777-8777-777777777777",
      paymentId: oldPayment,
      replacement: {
        id: replacement,
        method: "cash",
        amountMinor: 200,
        occurrenceAt: new Date().toISOString(),
      },
      reason: "Wrong amount",
      operationId: "88888888-8888-4888-8888-888888888888",
    });
    const { rows } = await pool.query(
      "SELECT COALESCE(SUM(debt_delta_minor),0)::text debt FROM customer_ledger WHERE business_id=$1 AND customer_id=$2",
      [business, customer],
    );
    const payment = await pool.query(
      "SELECT state,amount_minor::text FROM payments WHERE business_id=$1 AND id=$2",
      [business, replacement],
    );
    assert.equal(result.replacementPaymentId, replacement);
    assert.equal(payment.rows[0]?.state, "confirmed");
    assert.equal(payment.rows[0]?.amount_minor, "200");
    assert.equal(rows[0].debt, "800");
  } finally {
    await pool.end();
  }
});
