import { createPublicKey, verify } from "node:crypto";
import { pool, transaction } from "../config.js";
import { canonical, hash } from "../utils/validation.js";
import { z } from "zod";
import { parse, uuid, stateCode, gstin } from "../utils/validation.js";
import { upsertCustomer } from "./customers.js";
import { applyAdvance } from "./finance.js";
import { correctPayment, correctDelivery } from "./corrections.js";
import { correctLedgerEntry } from "./ledger-corrections.js";
import { createQuotation } from "./quotations.js";
import { decidePayment, decideCredit } from "./billing.js";
import { reviewDelivery } from "./delivery.js";
import { decideRequest } from "./requests.js";
import { openingBalance } from "./finance.js";
import { cancelBillInTransaction } from "./cancellation.js";
import { createBill } from "./billing.js";
import { recordDelivery } from "./delivery.js";
import { createRequest } from "./requests.js";
import { recordRepayment } from "./finance.js";
import { recordReturnInTransaction } from "./returns.js";
function fail(message, status = 403) {
  throw Object.assign(new Error(message), { status });
}
export async function uploadRevokedWork(input) {
  const message = {
    deviceId: input.deviceId,
    businessId: input.businessId,
    operationId: input.operationId,
    payloadType: input.payloadType,
    payload: input.payload,
    ...(input.originalRole ? { originalRole: input.originalRole } : {}),
    ...(input.dependencies ? { dependencies: input.dependencies } : {}),
  };
  return transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      input.deviceId,
    ]);
    const device = await db.query(
      "SELECT d.public_key,d.active,d.user_id,m.active membership_active,m.role FROM devices d JOIN memberships m ON m.user_id=d.user_id AND m.business_id=$2 WHERE d.id=$1",
      [input.deviceId, input.businessId],
    );
    const record = device.rows[0];
    if (
      !record?.public_key ||
      (record.active &&
        record.membership_active &&
        (!input.originalRole || input.originalRole === record.role))
    )
      fail("Recovery upload unavailable");
    let valid = false;
    try {
      valid = verify(
        null,
        Buffer.from(canonical(message)),
        createPublicKey({
          key: Buffer.from(record.public_key, "base64"),
          format: "der",
          type: "spki",
        }),
        Buffer.from(input.signature, "base64url"),
      );
    } catch {
      valid = false;
    }
    if (!valid) fail("Invalid device signature");
    const digest = hash(message);
    const old = await db.query(
      "SELECT payload_hash FROM quarantined_operations WHERE device_id=$1 AND operation_id=$2",
      [input.deviceId, input.operationId],
    );
    if (old.rows[0]) {
      if (old.rows[0].payload_hash !== digest)
        fail("Operation ID reused with different payload", 409);
      return { operationId: input.operationId, status: "quarantined" };
    }
    const count = await db.query(
      "SELECT COUNT(*)::integer count FROM quarantined_operations WHERE device_id=$1 AND received_at>now()-interval '1 hour'",
      [input.deviceId],
    );
    if (count.rows[0].count >= 100) fail("Recovery upload limit reached", 429);
    await db.query(
      "INSERT INTO quarantined_operations(device_id,operation_id,business_id,payload_type,payload,payload_hash,original_role,original_actor_id,claimed_role,device_signature,dependencies) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        input.deviceId,
        input.operationId,
        input.businessId,
        input.payloadType,
        input.payload,
        digest,
        input.originalRole && input.originalRole !== record.role
          ? null
          : record.role,
        record.user_id,
        input.originalRole ?? null,
        input.signature,
        JSON.stringify(input.dependencies ?? []),
      ],
    );
    await db.query(
      "INSERT INTO audit_events(business_id,actor_id,action,entity_id,operation_id,device_id) VALUES ($1,$2,'recovery.upload',$3,$3,$4)",
      [input.businessId, record.user_id, input.operationId, input.deviceId],
    );
    return { operationId: input.operationId, status: "quarantined" };
  });
}
export async function listQuarantine(businessId) {
  const { rows } = await pool.query(
    "SELECT q.device_id,q.operation_id,q.payload_type,q.payload,q.original_role,q.original_actor_id,u.email original_actor_email,q.claimed_role,q.dependencies,q.received_at,q.reviewed_at,q.reviewed_by,q.review_note,q.decision,q.decision_result FROM quarantined_operations q JOIN devices d ON d.id=q.device_id JOIN users u ON u.id=COALESCE(q.original_actor_id,d.user_id) WHERE q.business_id=$1 ORDER BY q.received_at DESC LIMIT 100",
    [businessId],
  );
  return rows.map((work) => ({
    ...work,
    manual_reconciliation_available: manualReconciliationAvailable(work),
  }));
}
const positive = z.number().int().positive().max(100000000);
const bill = z
  .object({
    id: uuid,
    customerId: uuid.nullable(),
    placeOfSupply: stateCode.optional(),
    quotationId: uuid.optional(),
    occurrenceAt: z.iso.datetime({ offset: true }),
    lines: z
      .array(
        z
          .object({
            id: uuid,
            itemId: uuid,
            unitId: uuid,
            catalogueVersion: z.number().int().positive(),
            quantityMilli: positive,
            overridePriceMinor: z
              .number()
              .int()
              .min(0)
              .max(Number.MAX_SAFE_INTEGER)
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    payments: z
      .array(
        z
          .object({
            id: uuid,
            method: z.enum(["cash", "upi", "bank"]),
            amountMinor: z
              .number()
              .int()
              .positive()
              .max(Number.MAX_SAFE_INTEGER),
          })
          .strict(),
      )
      .max(20),
    operationId: uuid,
  })
  .strict();
const delivery = z
  .object({
    id: uuid,
    billId: uuid,
    lineId: uuid,
    unitId: uuid,
    quantityMilli: positive,
    occurrenceAt: z.iso.datetime({ offset: true }),
    operationId: uuid,
    authorizationRevision: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
const request = z
  .object({
    id: uuid,
    type: z.enum(["bill_cancel", "return", "delivery_correct"]),
    targetId: uuid,
    payload: z.record(z.string(), z.unknown()),
    reason: z.string().trim().min(1).max(500),
    operationId: uuid,
  })
  .strict();
const repayment = z
  .object({
    customerId: uuid,
    amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    note: z.string().trim().min(1).max(500),
    occurrenceAt: z.iso.datetime({ offset: true }).optional(),
    operationId: uuid,
  })
  .strict();
const returned = z
  .object({
    id: uuid,
    billId: uuid,
    lineId: uuid,
    unitId: uuid.optional(),
    quantityMilli: positive,
    disposition: z.enum(["restockable", "damaged", "discarded"]),
    resolution: z.enum(["advance", "refund"]),
    refundId: uuid.optional(),
    refundMethod: z.enum(["cash", "upi", "bank"]).optional(),
    reason: z.string().trim().min(1).max(500),
    operationId: uuid,
  })
  .strict();

const customer = z
  .object({
    id: uuid,
    name: z.string().trim().min(1).max(160),
    phone: z.string().trim().min(5).max(30),
    gstin: gstin.optional(),
    address: z.string().trim().min(1).max(500).optional(),
    stateCode: stateCode.optional(),
    locality: z.string().trim().min(1).max(160),
    expectedVersion: z.number().int().positive().nullable().default(null),
    active: z.boolean().default(true),
    operationId: uuid,
  })
  .strict();
const opening = repayment
  .extend({ kind: z.enum(["debt", "advance"]) })
  .strict();
const cancelled = z
  .object({
    billId: uuid,
    reason: z.string().trim().min(1).max(500),
    operationId: uuid,
    resolution: z.enum(["advance", "refund"]).optional(),
    refundId: uuid.optional(),
    refundMethod: z.enum(["cash", "upi", "bank"]).optional(),
    lines: z
      .array(
        z
          .object({
            lineId: uuid,
            unitId: uuid.optional(),
            quantityMilli: positive,
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .optional(),
  })
  .strict();
const amount = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const reason = z.string().trim().min(1).max(500);
const correctionBase = { id: uuid, reason, operationId: uuid };
const paymentCorrection = z
  .object({
    ...correctionBase,
    paymentId: uuid,
    replacement: z
      .object({
        id: uuid,
        method: z.enum(["cash", "upi", "bank"]),
        amountMinor: amount,
        occurrenceAt: z.iso.datetime(),
      })
      .strict()
      .optional(),
  })
  .strict();
const ledgerCorrection = z
  .object({
    entryId: z
      .string()
      .regex(/^[1-9]\d{0,18}$/)
      .refine((v) => BigInt(v) <= 9223372036854775807n),
    reason,
    operationId: uuid,
    replacement: z
      .object({
        amountMinor: amount,
        openingKind: z.enum(["debt", "advance"]).optional(),
        occurrenceAt: z.iso.datetime({ offset: true }).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const quotation = z
  .object({
    id: uuid,
    placeOfSupply: stateCode.optional(),
    reference: z.string().trim().min(1).max(80),
    customerId: uuid.nullable(),
    lines: z
      .array(
        z
          .object({
            id: uuid,
            itemId: uuid,
            unitId: uuid,
            catalogueVersion: z.number().int().positive(),
            quantityMilli: positive,
            priceMinor: z
              .number()
              .int()
              .min(0)
              .max(Number.MAX_SAFE_INTEGER)
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    operationId: uuid,
  })
  .strict();
// Only these typed commands can execute. Path matching never dispatches a route.
const onlineCommands = {
  "advance.apply": {
    path: /^\/advance-applications$/,
    schema: z
      .object({
        customerId: uuid,
        billId: uuid,
        amountMinor: amount,
        operationId: uuid,
      })
      .strict(),
    run: (db, b, a, p) => applyAdvance(b, a, p, db),
  },
  "payment.correct": {
    path: /^\/payment-corrections$/,
    schema: paymentCorrection,
    run: (db, b, a, p) => correctPayment(b, a, p, db),
  },
  "delivery.correct": {
    path: /^\/delivery-corrections$/,
    schema: z.object({ ...correctionBase, deliveryId: uuid }).strict(),
    run: (db, b, a, p) => correctDelivery(b, a, p, db),
  },
  "ledger.correct": {
    path: /^\/ledger-corrections$/,
    schema: ledgerCorrection,
    run: (db, b, a, p) => correctLedgerEntry(b, a, p, db),
  },
  "quotation.create": {
    path: /^\/quotations$/,
    schema: quotation,
    run: (db, b, a, p) => createQuotation(b, a, p, db),
  },
  "payment.verify": {
    path: /^\/payments\/[0-9a-f-]+\/decision$/,
    target: "paymentId",
    schema: z
      .object({ paymentId: uuid, confirm: z.boolean(), operationId: uuid })
      .strict(),
    run: (db, b, a, p) => decidePayment(b, a, p, db),
  },
  "credit.review": {
    path: /^\/bills\/[0-9a-f-]+\/credit-decision$/,
    target: "billId",
    schema: z
      .object({ billId: uuid, approve: z.boolean(), operationId: uuid })
      .strict(),
    run: (db, b, a, p) => decideCredit(b, a, p, db),
  },
  "delivery.review": {
    path: /^\/delivery\/[0-9a-f-]+\/review$/,
    target: "id",
    schema: z
      .object({ id: uuid, accept: z.boolean(), operationId: uuid })
      .strict(),
    run: (db, b, a, p) => reviewDelivery(b, a, p, db),
  },
  "request.decide": {
    path: /^\/requests\/[0-9a-f-]+\/decision$/,
    target: "id",
    schema: z
      .object({
        id: uuid,
        approve: z.boolean(),
        reason,
        action: z.record(z.string(), z.unknown()).optional(),
        operationId: uuid,
      })
      .strict(),
    run: (db, b, a, p) => decideRequest(b, a, p, db),
  },
  "return.record": {
    path: /^\/returns$/,
    schema: returned,
    run: (db, b, a, p) => recordReturnInTransaction(db, b, a, p),
  },
  "repayment.cash": {
    path: /^\/repayments$/,
    schema: repayment,
    run: (db, b, a, p) => recordRepayment(b, a, p, db),
  },
  "balance.opening": {
    path: /^\/opening-balances$/,
    schema: opening,
    run: (db, b, a, p) => openingBalance(b, a, p, db),
  },
  "bill.cancel": {
    path: /^\/bills\/([0-9a-f-]+)\/cancel$/,
    schema: cancelled,
    target: "billId",
    run: (db, b, a, p) => cancelBillInTransaction(db, b, a, p),
  },
};

export async function decideQuarantine(
  businessId,
  deviceId,
  operationId,
  ownerId,
  input,
) {
  return transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [businessId]);
    const { rows } = await db.query(
      "SELECT q.*,COALESCE(q.original_actor_id,d.user_id) user_id FROM quarantined_operations q JOIN devices d ON d.id=q.device_id WHERE q.business_id=$1 AND q.device_id=$2 AND q.operation_id=$3 FOR UPDATE OF q",
      [businessId, deviceId, operationId],
    );
    const work = rows[0];
    if (!work) fail("Quarantined operation unavailable", 404);
    const inputHash = hash(input);
    if (work.decision_operation_id === input.decisionOperationId) {
      if (work.decision_input_hash !== inputHash)
        fail("Decision operation ID reused with different payload", 409);
      return work.decision_result;
    }
    if (work.decision !== "pending")
      fail("Quarantined operation already decided", 409);
    const used = await db.query(
      "SELECT 1 FROM quarantined_operations WHERE business_id=$1 AND decision_operation_id=$2",
      [businessId, input.decisionOperationId],
    );
    if (used.rowCount) fail("Decision operation ID already used", 409);
    const reviewer = await db.query(
      "SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.business_id=$1 AND m.user_id=$2 AND m.active=true AND m.role='owner' AND u.active=true",
      [businessId, ownerId],
    );
    if (!reviewer.rowCount) fail("Active owner review required");
    let actionResult = null;
    if (input.accept) {
      for (const dependency of work.dependencies ?? []) {
        const committed = await db.query(
          "SELECT 1 FROM operations WHERE business_id=$1 AND operation_id=$2",
          [businessId, dependency],
        );
        if (!committed.rowCount)
          fail("Recovery dependency requires owner reconciliation first", 409);
      }
      if (!work.original_role)
        fail(
          "Original role was not recorded; manual reconciliation required",
          409,
        );
      if (work.payload_type === "online_action") {
        const envelope = parse(
          z
            .object({
              operationType: z.string().max(100),
              method: z.string().max(10),
              path: z.string().max(300),
              payload: z.record(z.string(), z.unknown()),
            })
            .strict(),
          work.payload,
        );
        const command = Object.hasOwn(onlineCommands, envelope.operationType)
          ? onlineCommands[envelope.operationType]
          : undefined;
        if (
          !command ||
          envelope.method !== "POST" ||
          !command.path.test(envelope.path)
        ) {
          await db.query(
            "UPDATE quarantined_operations SET reviewed_at=now(),reviewed_by=$4,review_note=$5 WHERE business_id=$1 AND device_id=$2 AND operation_id=$3",
            [
              businessId,
              deviceId,
              operationId,
              ownerId,
              "Retained: unsupported original action; manual reconciliation required. " +
                input.reason,
            ],
          );
          await db.query(
            "INSERT INTO audit_events(business_id,actor_id,action,entity_id,operation_id) VALUES($1,$2,'quarantine.retained',$3,$4)",
            [businessId, ownerId, operationId, input.decisionOperationId],
          );
          return {
            deviceId,
            operationId,
            decision: "pending",
            status: "retained",
            reason:
              "Unsupported original action; manual reconciliation required",
          };
        }
        if (work.original_role !== "owner")
          fail("Original owner role required", 409);
        const payload = parse(command.schema, envelope.payload);
        if (
          payload.operationId !== operationId ||
          (command.target &&
            envelope.path.split("/")[2] !== payload[command.target])
        )
          fail("Original action target or operation ID mismatch", 409);
        const previous = (
          await db.query(
            "SELECT actor_id,operation_type,payload_hash FROM operations WHERE business_id=$1 AND operation_id=$2",
            [businessId, operationId],
          )
        ).rows[0];
        if (
          previous &&
          (previous.actor_id !== work.user_id ||
            previous.operation_type !== envelope.operationType ||
            previous.payload_hash !== hash(payload))
        )
          fail("Original operation identity mismatch", 409);
        actionResult = await command.run(db, businessId, work.user_id, payload);
      } else {
        const schema = {
          customer,
          bill,
          delivery,
          request,
          payment: repayment,
          return: returned,
        }[work.payload_type];
        if (!schema) fail("Unsupported recovery payload type", 409);
        const payload = parse(schema, work.payload);
        if (payload.operationId !== operationId)
          fail("Payload operation ID mismatch", 409);
        const previous = (
          await db.query(
            "SELECT actor_id,payload_hash,operation_type FROM operations WHERE business_id=$1 AND operation_id=$2",
            [businessId, operationId],
          )
        ).rows[0];
        if (
          previous &&
          (previous.actor_id !== work.user_id ||
            previous.payload_hash !== hash(payload) ||
            previous.operation_type !==
              {
                customer: "customer.upsert",
                bill: "bill.create",
                delivery: "delivery.record",
                request: "request.create",
                payment: "repayment.cash",
                return: "return.record",
              }[work.payload_type])
        )
          fail("Original operation identity mismatch", 409);
        if (work.payload_type === "customer") {
          actionResult = await upsertCustomer(
            businessId,
            work.user_id,
            payload,
            db,
          );
        } else if (work.payload_type === "bill") {
          if (
            new Set(payload.lines.map((x) => x.id)).size !==
              payload.lines.length ||
            new Set(payload.payments.map((x) => x.id)).size !==
              payload.payments.length
          )
            fail("Duplicate bill child ID", 400);
          actionResult = await createBill(
            businessId,
            work.user_id,
            work.original_role,
            payload,
            db,
          );
        } else if (work.payload_type === "delivery") {
          actionResult = await recordDelivery(
            businessId,
            work.user_id,
            work.original_role,
            payload,
            db,
          );
        } else if (
          work.payload_type === "payment" ||
          work.payload_type === "return"
        ) {
          if (work.original_role !== "owner")
            fail(
              "This financial recovery action requires an original owner actor",
              409,
            );
          actionResult =
            work.payload_type === "payment"
              ? await recordRepayment(businessId, work.user_id, payload, db)
              : await recordReturnInTransaction(
                  db,
                  businessId,
                  work.user_id,
                  payload,
                );
        } else {
          if (work.original_role !== "staff")
            fail("Only staff requests can be replayed", 409);
          actionResult = await createRequest(
            businessId,
            work.user_id,
            payload,
            db,
          );
        }
      }
    }
    const decision = input.accept ? "accepted" : "rejected";
    const result = { deviceId, operationId, decision, actionResult };
    await db.query(
      "UPDATE quarantined_operations SET decision=$4,decision_operation_id=$5,decision_input_hash=$6,decision_result=$7,reviewed_at=now(),reviewed_by=$8,review_note=$9 WHERE business_id=$1 AND device_id=$2 AND operation_id=$3",
      [
        businessId,
        deviceId,
        operationId,
        decision,
        input.decisionOperationId,
        inputHash,
        result,
        ownerId,
        input.reason,
      ],
    );
    await db.query(
      "INSERT INTO audit_events(business_id,actor_id,action,entity_id,operation_id) VALUES ($1,$2,$3,$4,$5)",
      [
        businessId,
        ownerId,
        `quarantine.${decision}`,
        operationId,
        input.decisionOperationId,
      ],
    );
    return result;
  });
}
export async function noteQuarantine(
  businessId,
  deviceId,
  operationId,
  actorId,
  note,
) {
  const { rows } = await pool.query(
    "UPDATE quarantined_operations SET reviewed_at=now(),reviewed_by=$4,review_note=$5 WHERE business_id=$1 AND device_id=$2 AND operation_id=$3 AND reviewed_at IS NULL RETURNING operation_id",
    [businessId, deviceId, operationId, actorId, note],
  );
  if (!rows[0]) fail("Quarantined operation unavailable", 404);
  return { operationId, status: "reviewed" };
}

// A manual resolution records the owner's finding; it cannot dispatch any command.
function manualReconciliationAvailable(work) {
  const envelope = work.payload;
  if (
    work.original_role !== "owner" ||
    work.payload_type !== "online_action" ||
    !envelope ||
    Object.hasOwn(onlineCommands, envelope.operationType)
  )
    return false;
  return (
    (envelope.method === "POST" &&
      [
        "/settings/activate-non-gst",
        "/settings/document-series",
        "/catalogue/import",
      ].includes(envelope.path)) ||
    (envelope.method === "PUT" &&
      (envelope.path === "/settings/document-profile" ||
        /^\/catalogue\/items\/[0-9a-f-]+$/.test(envelope.path)))
  );
}
export async function reconcileQuarantine(
  businessId,
  deviceId,
  operationId,
  ownerId,
  input,
) {
  return transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [businessId]);
    const reviewer = await db.query(
      "SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.business_id=$1 AND m.user_id=$2 AND m.active AND m.role='owner' AND u.active",
      [businessId, ownerId],
    );
    if (!reviewer.rowCount) fail("Active owner review required");
    const work = (
      await db.query(
        "SELECT * FROM quarantined_operations WHERE business_id=$1 AND device_id=$2 AND operation_id=$3 FOR UPDATE",
        [businessId, deviceId, operationId],
      )
    ).rows[0];
    if (!work) fail("Quarantined operation unavailable", 404);
    const digest = hash(input);
    if (work.decision_operation_id === input.decisionOperationId) {
      if (work.decision_input_hash !== digest)
        fail("Decision operation ID reused with different payload", 409);
      return work.decision_result;
    }
    if (work.decision !== "pending")
      fail("Quarantined operation already decided", 409);
    if (!manualReconciliationAvailable(work))
      fail(
        "Manual resolution is limited to unsupported nonfinancial owner actions; use typed financial reconciliation",
        409,
      );
    if (
      (
        await db.query(
          "SELECT 1 FROM quarantined_operations WHERE business_id=$1 AND decision_operation_id=$2",
          [businessId, input.decisionOperationId],
        )
      ).rowCount
    )
      fail("Decision operation ID already used", 409);
    const result = {
      deviceId,
      operationId,
      decision: "reconciled",
      status: "manually_reconciled",
      resolution: input.resolution,
      note: input.note,
    };
    await db.query(
      "UPDATE quarantined_operations SET decision='reconciled',decision_operation_id=$4,decision_input_hash=$5,decision_result=$6,reviewed_at=now(),reviewed_by=$7,review_note=$8 WHERE business_id=$1 AND device_id=$2 AND operation_id=$3",
      [
        businessId,
        deviceId,
        operationId,
        input.decisionOperationId,
        digest,
        result,
        ownerId,
        input.note,
      ],
    );
    await db.query(
      "INSERT INTO audit_events(business_id,actor_id,action,entity_id,operation_id) VALUES($1,$2,'quarantine.manually_reconciled',$3,$4)",
      [businessId, ownerId, operationId, input.decisionOperationId],
    );
    return result;
  });
}
