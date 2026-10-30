import { transaction } from "../config.js";
import { hash } from "../utils/validation.js";
import { adjustmentLine, settleAdjustment } from "./adjustments.js";

export async function recordReturn(businessId, actorId, input) {
  return transaction((db) =>
    recordReturnInTransaction(db, businessId, actorId, input),
  );
}
export async function recordReturnInTransaction(
  db,
  businessId,
  actorId,
  input,
) {
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
  const { line, unit, quantity, value, taxSnapshot } = await adjustmentLine(
    db,
    businessId,
    input.billId,
    input,
    "return",
  );
  const settlement = await settleAdjustment(
    db,
    businessId,
    actorId,
    line.customer_id,
    input,
    value,
  );
  await db.query(
    "INSERT INTO returns(id,business_id,bill_id,line_id,quantity_milli,value_minor,disposition,reason,actor_id,resolution,refund_id,canonical_quantity,unit_id,unit_label,factor,tax_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
    [
      input.id,
      businessId,
      input.billId,
      input.lineId,
      input.quantityMilli,
      value.toString(),
      input.disposition,
      input.reason,
      actorId,
      settlement.resolution,
      settlement.excessMinor !== "0" && input.resolution === "refund"
        ? input.refundId
        : null,
      quantity,
      unit.id,
      unit.label,
      unit.factor,
      taxSnapshot,
    ],
  );
  const result = {
    id: input.id,
    billId: input.billId,
    valueMinor: value.toString(),
    canonicalQuantity: quantity,
    taxSnapshot,
    ...settlement,
  };
  await db.query(
    "INSERT INTO operations(business_id,operation_id,operation_type,actor_id,payload_hash,result) VALUES ($1,$2,'return.record',$3,$4,$5)",
    [businessId, input.operationId, actorId, digest, result],
  );
  await db.query(
    "INSERT INTO audit_events(business_id,actor_id,action,entity_id,operation_id) VALUES ($1,$2,'return.record',$3,$4)",
    [businessId, actorId, input.id, input.operationId],
  );
  await db.query(
    "INSERT INTO change_log(business_id,kind,entity_id,version) VALUES ($1,'bill',$2,1)",
    [businessId, input.billId],
  );
  return result;
}
