import { pool, transaction } from "../config.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { hash, parse, uuid } from "../utils/validation.js";
import { cancelBillInTransaction } from "./cancellation.js";
import { recordReturnInTransaction } from "./returns.js";
import { correctDelivery } from "./corrections.js";
function fail(message, status = 409) {
  throw Object.assign(new Error(message), { status });
}
const returnRequest = z
  .object({
    lineId: uuid,
    unitId: uuid.optional(),
    quantityMilli: z.number().int().positive().max(100000000),
    disposition: z.enum(["restockable", "damaged", "discarded"]),
  })
  .strict();
const returnDecision = z
  .object({
    resolution: z.enum(["advance", "refund"]),
    refundMethod: z.enum(["cash", "upi", "bank"]).optional(),
  })
  .strict();
function validatePayload(type, payload) {
  return type === "return"
    ? parse(returnRequest, payload)
    : type === "bill_cancel"
      ? parse(
          z
            .object({
              lines: z
                .array(
                  z
                    .object({
                      lineId: uuid,
                      unitId: uuid.optional(),
                      quantityMilli: z.number().int().positive().max(100000000),
                    })
                    .strict(),
                )
                .min(1)
                .max(100)
                .optional(),
            })
            .strict(),
          payload,
        )
      : parse(z.object({}).strict(), payload);
}
export async function createRequest(businessId, actorId, input, existingDb) {
  input = { ...input, payload: validatePayload(input.type, input.payload) };
  const run = async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [businessId]);
    const digest = hash(input),
      old = await db.query(
        "SELECT payload_hash,result FROM operations WHERE business_id=$1 AND operation_id=$2",
        [businessId, input.operationId],
      );
    if (old.rows[0]) {
      if (old.rows[0].payload_hash !== digest)
        fail("Operation ID reused with different payload");
      return old.rows[0].result;
    }
    const reference =
      input.type === "delivery_correct"
        ? await db.query(
            "SELECT id FROM delivery_events WHERE business_id=$1 AND id=$2",
            [businessId, input.targetId],
          )
        : await db.query(
            "SELECT id FROM bills WHERE business_id=$1 AND id=$2",
            [businessId, input.targetId],
          );
    if (!reference.rowCount) fail("Target unavailable", 404);
    await db.query(
      "INSERT INTO requests(id,business_id,type,target_id,payload,reason,actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [
        input.id,
        businessId,
        input.type,
        input.targetId,
        input.payload,
        input.reason,
        actorId,
      ],
    );
    const result = { id: input.id, state: "pending" };
    await db.query(
      "INSERT INTO operations(business_id,operation_id,operation_type,actor_id,payload_hash,result) VALUES ($1,$2,$3,$4,$5,$6)",
      [
        businessId,
        input.operationId,
        "request.create",
        actorId,
        digest,
        result,
      ],
    );
    await db.query(
      "INSERT INTO audit_events(business_id,actor_id,action,entity_id,operation_id) VALUES ($1,$2,$3,$4,$5)",
      [businessId, actorId, "request.create", input.id, input.operationId],
    );
    await db.query(
      "INSERT INTO push_jobs(business_id,user_id,category,reference_id) SELECT $1,m.user_id,'staff_request',$2 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.business_id=$1 AND m.role='owner' AND m.active=true AND u.active=true ON CONFLICT DO NOTHING",
      [businessId, input.id],
    );
    return result;
  };
  return existingDb ? run(existingDb) : transaction(run);
}
export async function listRequests(businessId, actorId, role) {
  const { rows } = await pool.query(
    "SELECT id,type,target_id,payload,reason,actor_id,state,decision_by,decision_reason,performed_operation_id,created_at,decided_at FROM requests WHERE business_id=$1 AND ($2::boolean OR actor_id=$3) ORDER BY created_at DESC LIMIT 100",
    [businessId, role === "owner", actorId],
  );
  return rows;
}
export async function decideRequest(businessId, actorId, input, existingDb) {
  const run = async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [businessId]);
    const digest = hash(input),
      old = await db.query(
        "SELECT payload_hash,result FROM operations WHERE business_id=$1 AND operation_id=$2",
        [businessId, input.operationId],
      );
    if (old.rows[0]) {
      if (old.rows[0].payload_hash !== digest)
        fail("Operation ID reused with different payload");
      return old.rows[0].result;
    }
    const request = await db.query(
      "SELECT type,target_id,state FROM requests WHERE business_id=$1 AND id=$2 FOR UPDATE",
      [businessId, input.id],
    );
    if (request.rows[0]?.state !== "pending") fail("Request not pending");
    let performedOperationId = null,
      actionResult = null;
    if (input.approve) {
      performedOperationId = randomUUID();
      const target = request.rows[0].target_id;
      if (request.rows[0].type === "bill_cancel") {
        const saved = await db.query(
          "SELECT payload FROM requests WHERE business_id=$1 AND id=$2",
          [businessId, input.id],
        );
        const payload = validatePayload("bill_cancel", saved.rows[0].payload);
        const decision = input.action
          ? parse(returnDecision, input.action)
          : {};
        actionResult = await cancelBillInTransaction(db, businessId, actorId, {
          billId: target,
          lines: payload.lines,
          resolution: decision.resolution,
          refundId: decision.resolution === "refund" ? randomUUID() : undefined,
          refundMethod: decision.refundMethod,
          reason: input.reason,
          operationId: performedOperationId,
        });
      } else if (request.rows[0].type === "delivery_correct")
        actionResult = await correctDelivery(
          businessId,
          actorId,
          {
            id: randomUUID(),
            deliveryId: target,
            reason: input.reason,
            operationId: performedOperationId,
          },
          db,
        );
      else {
        const saved = await db.query(
          "SELECT payload FROM requests WHERE business_id=$1 AND id=$2",
          [businessId, input.id],
        );
        const payload = validatePayload("return", saved.rows[0].payload);
        const decision = parse(returnDecision, input.action ?? {});
        actionResult = await recordReturnInTransaction(
          db,
          businessId,
          actorId,
          {
            id: randomUUID(),
            billId: target,
            lineId: payload.lineId,
            unitId: payload.unitId,
            quantityMilli: payload.quantityMilli,
            disposition: payload.disposition,
            resolution: decision.resolution,
            refundId:
              decision.resolution === "refund" ? randomUUID() : undefined,
            refundMethod: decision.refundMethod,
            reason: input.reason,
            operationId: performedOperationId,
          },
        );
      }
    }
    const state = input.approve ? "approved" : "rejected";
    await db.query(
      "UPDATE requests SET state=$3,decision_by=$4,decision_reason=$5,performed_operation_id=$6,decided_at=now() WHERE business_id=$1 AND id=$2",
      [
        businessId,
        input.id,
        state,
        actorId,
        input.reason,
        performedOperationId,
      ],
    );
    const result = { id: input.id, state, performedOperationId, actionResult };
    await db.query(
      "INSERT INTO operations(business_id,operation_id,operation_type,actor_id,payload_hash,result) VALUES ($1,$2,$3,$4,$5,$6)",
      [
        businessId,
        input.operationId,
        "request.decide",
        actorId,
        digest,
        result,
      ],
    );
    await db.query(
      "INSERT INTO audit_events(business_id,actor_id,action,entity_id,operation_id) VALUES ($1,$2,$3,$4,$5)",
      [businessId, actorId, "request.decide", input.id, input.operationId],
    );
    return result;
  };
  return existingDb ? run(existingDb) : transaction(run);
}
