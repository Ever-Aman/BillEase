import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync, sign } from "node:crypto";
import { pool } from "../src/config.js";
import { saleFixture } from "./helpers/fixtures.js";
import { hash } from "../src/utils/validation.js";
import { canonical } from "../src/utils/validation.js";
import {
  uploadRevokedWork,
  decideQuarantine,
  listQuarantine,
} from "../src/services/quarantine.js";
import { recordRepayment } from "../src/services/finance.js";

test("recovery retains originals, reconciles customer dependencies and previously committed owner actions", async () => {
  try {
    const f = await saleFixture();
    const deviceId = randomUUID(),
      keys = generateKeyPairSync("ed25519");
    await pool.query(
      "INSERT INTO devices(id,user_id,name,active,public_key) VALUES ($1,$2,'Old phone',false,$3)",
      [
        deviceId,
        f.owner,
        keys.publicKey
          .export({ type: "spki", format: "der" })
          .toString("base64"),
      ],
    );
    const upload = async (
      payloadType,
      payload,
      role = "owner",
      dependencies = [],
    ) => {
      const message = {
        deviceId,
        businessId: f.business,
        operationId: payload.operationId ?? payload.payload.operationId,
        payloadType,
        payload,
        originalRole: role,
        dependencies,
      };
      return uploadRevokedWork({
        ...message,
        signature: sign(
          null,
          Buffer.from(canonical(message)),
          keys.privateKey,
        ).toString("base64url"),
      });
    };
    const decide = (operationId) =>
      decideQuarantine(f.business, deviceId, operationId, f.owner, {
        accept: true,
        reason: "Verified original",
        decisionOperationId: randomUUID(),
      });
    const customer = {
      id: randomUUID(),
      name: "Recovered",
      phone: "1234567890",
      locality: "Old work",
      expectedVersion: null,
      active: true,
      operationId: randomUUID(),
    };
    const bill = {
      id: randomUUID(),
      customerId: customer.id,
      occurrenceAt: new Date().toISOString(),
      lines: [
        {
          id: randomUUID(),
          itemId: f.item,
          unitId: f.piece,
          catalogueVersion: 1,
          quantityMilli: 1000,
        },
      ],
      payments: [],
      operationId: randomUUID(),
    };
    await upload("customer", customer);
    await upload("bill", bill, "owner", [customer.operationId]);
    assert.equal(
      (await pool.query("SELECT 1 FROM customers WHERE id=$1", [customer.id]))
        .rowCount,
      0,
    );
    await assert.rejects(decide(bill.operationId), /dependency/);
    assert.equal((await decide(customer.operationId)).decision, "accepted");
    assert.equal((await decide(bill.operationId)).decision, "accepted");
    const delivery = {
      id: randomUUID(),
      billId: bill.id,
      lineId: bill.lines[0].id,
      unitId: f.piece,
      quantityMilli: 1000,
      occurrenceAt: new Date().toISOString(),
      operationId: randomUUID(),
    };
    await upload("delivery", delivery);
    assert.equal((await decide(delivery.operationId)).decision, "accepted");
    const payment = {
      customerId: f.customer,
      amountMinor: 50,
      note: "Uncertain original",
      operationId: randomUUID(),
    };
    const original = await recordRepayment(f.business, f.owner, payment);
    await upload("online_action", {
      operationType: "repayment.cash",
      method: "POST",
      path: "/repayments",
      payload: payment,
    });
    assert.deepEqual(
      (await decide(payment.operationId)).actionResult,
      original,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT 1 FROM customer_ledger WHERE source_operation_id=$1",
          [payment.operationId],
        )
      ).rowCount,
      1,
    );
    const returned = {
      id: randomUUID(),
      billId: bill.id,
      lineId: bill.lines[0].id,
      unitId: f.piece,
      quantityMilli: 1000,
      disposition: "restockable",
      resolution: "advance",
      reason: "Original owner return",
      operationId: randomUUID(),
    };
    await upload("online_action", {
      operationType: "return.record",
      method: "POST",
      path: "/returns",
      payload: returned,
    });
    assert.equal((await decide(returned.operationId)).decision, "accepted");
    assert.equal(
      (
        await pool.query("SELECT actor_id FROM returns WHERE id=$1", [
          returned.id,
        ])
      ).rows[0].actor_id,
      f.owner,
    );
    const opening = {
      customerId: customer.id,
      amountMinor: 500,
      kind: "advance",
      note: "Original advance",
      operationId: randomUUID(),
    };
    await upload("online_action", {
      operationType: "balance.opening",
      method: "POST",
      path: "/opening-balances",
      payload: opening,
    });
    assert.equal((await decide(opening.operationId)).decision, "accepted");
    const quotation = {
      id: randomUUID(),
      reference: "Recovered quote",
      customerId: customer.id,
      lines: [
        {
          id: randomUUID(),
          itemId: f.item,
          unitId: f.piece,
          catalogueVersion: 1,
          quantityMilli: 1000,
        },
      ],
      operationId: randomUUID(),
    };
    await upload("online_action", {
      operationType: "quotation.create",
      method: "POST",
      path: "/quotations",
      payload: quotation,
    });
    assert.equal((await decide(quotation.operationId)).decision, "accepted");
    assert.equal(
      (
        await pool.query("SELECT actor_id FROM quotations WHERE id=$1", [
          quotation.id,
        ])
      ).rows[0].actor_id,
      f.owner,
    );
    // Persisted outcomes for every typed owner command must win over replay.
    const known = [
      [
        "advance.apply",
        "/advance-applications",
        { customerId: f.customer, billId: f.bill, amountMinor: 10 },
      ],
      [
        "payment.correct",
        "/payment-corrections",
        { id: randomUUID(), paymentId: randomUUID(), reason: "Original" },
      ],
      [
        "delivery.correct",
        "/delivery-corrections",
        { id: randomUUID(), deliveryId: randomUUID(), reason: "Original" },
      ],
      [
        "ledger.correct",
        "/ledger-corrections",
        { entryId: "1", reason: "Original" },
      ],
      [
        "payment.verify",
        `/payments/${f.line}/decision`,
        { paymentId: f.line, confirm: true },
      ],
      [
        "credit.review",
        `/bills/${f.bill}/credit-decision`,
        { billId: f.bill, approve: true },
      ],
      [
        "delivery.review",
        `/delivery/${f.line}/review`,
        { id: f.line, accept: true },
      ],
      [
        "request.decide",
        `/requests/${f.line}/decision`,
        { id: f.line, approve: false, reason: "Original" },
      ],
      [
        "bill.cancel",
        `/bills/${f.bill}/cancel`,
        { billId: f.bill, reason: "Original" },
      ],
    ];
    for (const [operationType, path, fields] of known) {
      const payload = { ...fields, operationId: randomUUID() };
      const result = { original: operationType };
      await pool.query(
        "INSERT INTO operations(business_id,operation_id,operation_type,actor_id,payload_hash,result) VALUES($1,$2,$3,$4,$5,$6)",
        [
          f.business,
          payload.operationId,
          operationType,
          f.owner,
          hash(payload),
          result,
        ],
      );
      await upload("online_action", {
        operationType,
        method: "POST",
        path,
        payload,
      });
      assert.deepEqual(
        (await decide(payload.operationId)).actionResult,
        result,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int count FROM operations WHERE business_id=$1 AND operation_id=$2",
            [f.business, payload.operationId],
          )
        ).rows[0].count,
        1,
      );
    }
    const unsupported = { operationId: randomUUID() };
    await upload("online_action", {
      operationType: "unsupported",
      method: "POST",
      path: "/admin/arbitrary",
      payload: unsupported,
    });
    assert.equal((await decide(unsupported.operationId)).status, "retained");
    assert.equal(
      (await listQuarantine(f.business)).find(
        (x) => x.operation_id === unsupported.operationId,
      ).decision,
      "pending",
    );
    const hostile = { operationId: randomUUID() };
    await upload("online_action", {
      operationType: "__proto__",
      method: "POST",
      path: "/returns",
      payload: hostile,
    });
    assert.equal((await decide(hostile.operationId)).status, "retained");
    await pool.query(
      "UPDATE memberships SET role='staff' WHERE user_id=$1 AND business_id=$2",
      [f.owner, f.business],
    );
    const stale = { ...payment, operationId: randomUUID() };
    await upload("payment", stale);
    const reviewer = randomUUID();
    await pool.query(
      "INSERT INTO users(id,email,password_hash) VALUES($1,$2,'test')",
      [reviewer, `${reviewer}@example.com`],
    );
    await pool.query(
      "INSERT INTO memberships(user_id,business_id,role) VALUES($1,$2,'owner')",
      [reviewer, f.business],
    );
    await assert.rejects(
      decideQuarantine(f.business, deviceId, stale.operationId, reviewer, {
        accept: true,
        reason: "Review with current owner",
        decisionOperationId: randomUUID(),
      }),
      /Original role/,
    );
    await assert.rejects(decide(stale.operationId), /owner/i);
  } finally {
    await pool.end();
  }
});
