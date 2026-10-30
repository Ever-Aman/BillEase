import { randomUUID } from "node:crypto";
import { pool, transaction } from "../config.js";
import { hash } from "../utils/validation.js";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reviewReasons = new Set([
  "Item version conflict",
  "Customer version conflict",
  "Return exceeds billed quantity",
  "Return exceeds handed-over quantity",
  "Return exceeds eligible delivered quantity",
  "Cancellation exceeds undelivered quantity",
  "No distinct undelivered quantities available",
  "Delivery exceeds confirmed financial coverage; owner credit release required",
  "Delivery correction would erase quantities already returned",
  "Correction would create a negative balance; reconcile already used funds first",
  "Advance exceeds available balance or bill due",
  "Digital receipt needs verification or approved credit",
  "Period boundary needs owner review",
  "Resolve deliveries, returns, and payments before cancellation",
  "Bill cannot be cancelled",
  "Request not pending",
  "Payment advance has already been used; reconcile it first",
]);

export async function recordSyncConflict(error, req) {
  if (
    error.status !== 409 ||
    !reviewReasons.has(error.message) ||
    !req.user?.id ||
    req.method === "GET"
  )
    return null;
  const match = req.originalUrl?.match(
    /^\/v1\/businesses\/([0-9a-f-]{36})(?:\/|\?|$)/i,
  );
  const businessId = match?.[1];
  const operationId = req.body?.operationId;
  if (!uuid.test(businessId || "") || !uuid.test(operationId || ""))
    return null;
  const path = req.originalUrl.split("?")[0].slice(0, 300);
  const { rows } = await pool.query(
    `INSERT INTO sync_conflicts(id,business_id,actor_id,operation_id,method,path,payload,reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT(business_id,actor_id,operation_id) DO UPDATE SET last_seen_at=now()
       WHERE sync_conflicts.method=$5 AND sync_conflicts.path=$6 AND sync_conflicts.payload=$7::jsonb
     RETURNING id`,
    [
      randomUUID(),
      businessId,
      req.user.id,
      operationId,
      req.method,
      path,
      req.body,
      error.message,
    ],
  );
  if (!rows[0])
    throw Object.assign(
      new Error("Operation ID reused with different payload"),
      { status: 409 },
    );
  return rows[0].id;
}

export async function guardConflictOperation(req, res, next) {
  try {
    if (
      ["GET", "HEAD", "OPTIONS"].includes(req.method) ||
      !uuid.test(req.body?.operationId || "")
    )
      return next();
    const match = req.originalUrl?.match(
      /^\/v1\/businesses\/([0-9a-f-]{36})(?:\/|\?|$)/i,
    );
    if (!match || !uuid.test(match[1])) return next();
    const { rows } = await pool.query(
      "SELECT status,resolution,payload=$4::jsonb AS same_payload FROM sync_conflicts WHERE business_id=$1 AND actor_id=$2 AND operation_id=$3",
      [match[1], req.user.id, req.body.operationId, req.body],
    );
    if (
      rows[0] &&
      (!rows[0].same_payload ||
        (rows[0].status === "resolved" &&
          rows[0].resolution !== "retry_after_sync"))
    )
      return res.status(409).json({
        error:
          "Conflict operation cannot be submitted again; create a new operation after review",
        outcome: "permanent",
      });
    next();
  } catch (error) {
    next(error);
  }
}

export async function listSyncConflicts(businessId) {
  const { rows } = await pool.query(
    "SELECT id,actor_id,operation_id,method,path,payload,reason,status,resolution,replacement_operation_id,reviewed_by,review_note,first_seen_at,last_seen_at,resolved_at FROM sync_conflicts WHERE business_id=$1 ORDER BY (status='open') DESC,first_seen_at DESC LIMIT 100",
    [businessId],
  );
  return rows;
}

export async function resolveSyncConflict(businessId, actorId, input) {
  return transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [businessId]);
    const digest = hash(input);
    const old = await db.query(
      "SELECT payload_hash,result FROM operations WHERE business_id=$1 AND operation_id=$2",
      [businessId, input.operationId],
    );
    if (old.rows[0]) {
      if (old.rows[0].payload_hash !== digest)
        throw Object.assign(
          new Error("Operation ID reused with different payload"),
          { status: 409 },
        );
      return old.rows[0].result;
    }
    if (input.resolution === "superseded") {
      if (!input.replacementOperationId)
        throw Object.assign(new Error("Replacement operation required"), {
          status: 400,
        });
      const operation = await db.query(
        "SELECT 1 FROM operations WHERE business_id=$1 AND operation_id=$2",
        [businessId, input.replacementOperationId],
      );
      if (!operation.rowCount)
        throw Object.assign(new Error("Replacement operation unavailable"), {
          status: 404,
        });
    } else if (input.replacementOperationId)
      throw Object.assign(
        new Error("Replacement operation is only for superseded conflicts"),
        { status: 400 },
      );
    const { rows } = await db.query(
      "UPDATE sync_conflicts SET status='resolved',resolution=$3,replacement_operation_id=$4,reviewed_by=$5,review_note=$6,resolved_at=now() WHERE business_id=$1 AND id=$2 AND status='open' RETURNING id,operation_id,resolution",
      [
        businessId,
        input.id,
        input.resolution,
        input.replacementOperationId ?? null,
        actorId,
        input.note,
      ],
    );
    if (!rows[0])
      throw Object.assign(new Error("Conflict unavailable"), { status: 404 });
    await db.query(
      "INSERT INTO operations(business_id,operation_id,operation_type,actor_id,payload_hash,result) VALUES ($1,$2,$3,$4,$5,$6)",
      [
        businessId,
        input.operationId,
        "sync_conflict.resolve",
        actorId,
        digest,
        rows[0],
      ],
    );
    await db.query(
      "INSERT INTO audit_events(business_id,actor_id,action,entity_id,operation_id) VALUES ($1,$2,$3,$4,$5)",
      [
        businessId,
        actorId,
        "sync_conflict.resolve",
        input.id,
        input.operationId,
      ],
    );
    return rows[0];
  });
}
