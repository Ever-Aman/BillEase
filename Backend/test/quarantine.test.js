import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/config.js";
import { decideQuarantine } from "../src/services/quarantine.js";
import { initializeDocumentSeries } from "../src/services/settings.js";
import { yearOf } from "../src/utils/fiscal-year.js";

if (
  process.env.APP_ENV !== "development" ||
  !new URL(process.env.DATABASE_URL).pathname.includes("_tdd_")
)
  throw new Error(
    "Quarantine test requires an isolated development _tdd_ database",
  );

test("owner decision replays revoked staff work once and keeps original actor", async () => {
  const business = "11111111-1111-4111-8111-111111111111";
  const staff = "22222222-2222-4222-8222-222222222222";
  const owner = "33333333-3333-4333-8333-333333333333";
  const device = "44444444-4444-4444-8444-444444444444";
  const bill = "55555555-5555-4555-8555-555555555555";
  const operation = "66666666-6666-4666-8666-666666666666";
  const requestId = "77777777-7777-4777-8777-777777777777";
  const decisionId = "88888888-8888-4888-8888-888888888888";
  try {
    await pool.query(
      "INSERT INTO users(id,email,password_hash) VALUES ($1,'staff@example.com','x'),($2,'owner@example.com','x')",
      [staff, owner],
    );
    await pool.query(
      "INSERT INTO businesses(id,name,document_mode,document_profile) VALUES ($1,'Test','non_gst',$2)",
      [business, { name: "Test", address: "Address", phone: "000" }],
    );
    await pool.query(
      "INSERT INTO memberships(user_id,business_id,role,active) VALUES ($1,$3,'staff',false),($2,$3,'owner',true)",
      [staff, owner, business],
    );
    await pool.query(
      "INSERT INTO devices(id,user_id,name,active) VALUES ($1,$2,'Old phone',false)",
      [device, staff],
    );
    await initializeDocumentSeries(business, owner, {
      financialYear: yearOf(new Date()),
      lastNumber: 99,
      operationId: "15151515-1515-4515-8515-151515151515",
    });
    await pool.query(
      "INSERT INTO bills(id,business_id,actor_id,financial_year,invoice_number,total_minor,review_state,occurrence_at) VALUES ($1,$2,$3,'2026-27',99,100,'not_required',now())",
      [bill, business, staff],
    );
    const payload = {
      id: requestId,
      type: "bill_cancel",
      targetId: bill,
      payload: {},
      reason: "Wrong bill",
      operationId: operation,
    };
    await pool.query(
      "INSERT INTO quarantined_operations(device_id,operation_id,business_id,payload_type,payload,payload_hash,original_role) VALUES ($1,$2,$3,'request',$4,'test','staff')",
      [device, operation, business, payload],
    );
    const decision = {
      accept: true,
      reason: "Verified with staff",
      decisionOperationId: decisionId,
    };
    const first = await decideQuarantine(
      business,
      device,
      operation,
      owner,
      decision,
    );
    assert.equal(first.decision, "accepted");
    assert.deepEqual(
      await decideQuarantine(business, device, operation, owner, decision),
      first,
    );
    const { rows } = await pool.query(
      "SELECT actor_id FROM requests WHERE business_id=$1 AND id=$2",
      [business, requestId],
    );
    assert.equal(rows[0].actor_id, staff);
    await assert.rejects(
      decideQuarantine(business, device, operation, owner, {
        ...decision,
        reason: "Changed",
      }),
      /different payload/,
    );
    const second = "99999999-9999-4999-8999-999999999999";
    await pool.query(
      "INSERT INTO quarantined_operations(device_id,operation_id,business_id,payload_type,payload,payload_hash) VALUES ($1,$2,$3,'payment','{}','test')",
      [device, second, business],
    );
    const rejected = await decideQuarantine(business, device, second, owner, {
      accept: false,
      reason: "Duplicate",
      decisionOperationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    assert.equal(rejected.decision, "rejected");
    assert.equal(rejected.actionResult, null);

    const item = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const unit = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const newBill = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const newBillOperation = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const line = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const payment = "10101010-1010-4010-8010-101010101010";
    await pool.query(
      "INSERT INTO items(id,business_id,name,canonical_unit) VALUES ($1,$2,'Rice','kg')",
      [item, business],
    );
    await pool.query(
      "INSERT INTO item_units(id,business_id,item_id,label,factor,price_minor) VALUES ($1,$2,$3,'kg',1,100)",
      [unit, business, item],
    );
    await pool.query(
      "INSERT INTO catalogue_revisions(business_id,item_id,version,snapshot,actor_id) VALUES ($1,$2,1,$3,$4)",
      [
        business,
        item,
        {
          id: item,
          active: true,
          version: 1,
          name: "Rice",
          canonicalUnit: "kg",
          units: [
            {
              id: unit,
              label: "kg",
              factor: "1",
              priceMinor: "100",
              active: true,
            },
          ],
        },
        owner,
      ],
    );
    const billPayload = {
      id: newBill,
      customerId: null,
      occurrenceAt: new Date().toISOString(),
      lines: [
        {
          id: line,
          itemId: item,
          unitId: unit,
          catalogueVersion: 1,
          quantityMilli: 1000,
        },
      ],
      payments: [{ id: payment, method: "cash", amountMinor: 100 }],
      operationId: newBillOperation,
    };
    await pool.query(
      "INSERT INTO quarantined_operations(device_id,operation_id,business_id,payload_type,payload,payload_hash,original_role) VALUES ($1,$2,$3,'bill',$4,'test','staff')",
      [device, newBillOperation, business, billPayload],
    );
    const billDecision = await decideQuarantine(
      business,
      device,
      newBillOperation,
      owner,
      {
        accept: true,
        reason: "Verified bill",
        decisionOperationId: "11111111-1111-4111-8111-111111111112",
      },
    );
    assert.equal(billDecision.actionResult.totalMinor, "100");
    const billRow = await pool.query(
      "SELECT actor_id FROM bills WHERE business_id=$1 AND id=$2",
      [business, newBill],
    );
    assert.equal(billRow.rows[0].actor_id, staff);

    const deliveryId = "12121212-1212-4212-8212-121212121212";
    const deliveryOperation = "13131313-1313-4313-8313-131313131313";
    const deliveryPayload = {
      id: deliveryId,
      billId: newBill,
      lineId: line,
      unitId: unit,
      quantityMilli: 1000,
      occurrenceAt: new Date().toISOString(),
      operationId: deliveryOperation,
    };
    await pool.query(
      "INSERT INTO quarantined_operations(device_id,operation_id,business_id,payload_type,payload,payload_hash,original_role) VALUES ($1,$2,$3,'delivery',$4,'test','staff')",
      [device, deliveryOperation, business, deliveryPayload],
    );
    const deliveryDecision = await decideQuarantine(
      business,
      device,
      deliveryOperation,
      owner,
      {
        accept: true,
        reason: "Verified delivery",
        decisionOperationId: "14141414-1414-4414-8414-141414141414",
      },
    );
    assert.equal(deliveryDecision.actionResult.state, "review_pending");
    const deliveryRow = await pool.query(
      "SELECT actor_id FROM delivery_events WHERE business_id=$1 AND id=$2",
      [business, deliveryId],
    );
    assert.equal(deliveryRow.rows[0].actor_id, staff);
  } finally {
    await pool.end();
  }
});
