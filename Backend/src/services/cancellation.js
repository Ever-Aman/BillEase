import { randomUUID } from "node:crypto";
import { transaction } from "../config.js";
import { hash } from "../utils/validation.js";
import { adjustmentLine, settleAdjustment } from "./adjustments.js";

function fail(message, status = 409) {
  throw Object.assign(new Error(message), { status });
}
export async function cancelBill(businessId, actorId, input) {
  return transaction((db) =>
    cancelBillInTransaction(db, businessId, actorId, input),
  );
}
export async function cancelBillInTransaction(db, businessId, actorId, input) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [businessId]);
  const digest = hash(input);
  const old = await db.query(
    "SELECT payload_hash,result FROM operations WHERE business_id=$1 AND operation_id=$2",
    [businessId, input.operationId],
  );
  if (old.rows[0]) {
    if (old.rows[0].payload_hash !== digest)
      fail("Operation ID reused with different payload");
    return old.rows[0].result;
  }
  let selected = input.lines;
  if (!selected) {
    selected = (
      await db.query(
        'SELECT line_id AS "lineId",GREATEST(billed_canonical-delivered_canonical-cancelled_canonical,0)::text AS "canonicalQuantity" FROM bill_line_quantities WHERE business_id=$1 AND bill_id=$2 AND billed_canonical>delivered_canonical+cancelled_canonical',
        [businessId, input.billId],
      )
    ).rows;
  }
  if (
    !selected.length ||
    new Set(selected.map((x) => x.lineId)).size !== selected.length
  )
    fail("No distinct undelivered quantities available");
  let total = 0n,
    customerId;
  const ids = [];
  const taxSnapshots = [];
  for (const inputLine of selected) {
    const { line, unit, quantity, value, enteredMilli, taxSnapshot } =
      await adjustmentLine(db, businessId, input.billId, inputLine, "cancel");
    customerId = line.customer_id;
    const id = randomUUID();
    ids.push(id);
    if (taxSnapshot) taxSnapshots.push({ adjustmentId: id, ...taxSnapshot });
    total += value;
    await db.query(
      "INSERT INTO line_cancellations(id,business_id,bill_id,line_id,operation_id,quantity_milli,unit_id,unit_label,factor,canonical_quantity,value_minor,actor_id,reason,tax_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
      [
        id,
        businessId,
        input.billId,
        inputLine.lineId,
        input.operationId,
        enteredMilli,
        unit.id,
        unit.label,
        unit.factor,
        quantity,
        value.toString(),
        actorId,
        input.reason,
        taxSnapshot,
      ],
    );
  }
  const settlement = await settleAdjustment(
    db,
    businessId,
    actorId,
    customerId,
    input,
    total,
  );
  const full = await db.query(
    "SELECT bool_and(cancelled_canonical=billed_canonical) yes FROM bill_line_quantities WHERE business_id=$1 AND bill_id=$2",
    [businessId, input.billId],
  );
  const lifecycle = full.rows[0].yes ? "cancelled" : "issued";
  if (lifecycle === "cancelled") {
    await db.query(
      "UPDATE bills SET lifecycle='cancelled' WHERE business_id=$1 AND id=$2",
      [businessId, input.billId],
    );
  }
  const result = {
    billId: input.billId,
    lifecycle,
    adjustmentIds: ids,
    taxSnapshots,
    valueMinor: total.toString(),
    ...settlement,
  };
  await db.query(
    "INSERT INTO operations(business_id,operation_id,operation_type,actor_id,payload_hash,result) VALUES ($1,$2,'bill.cancel',$3,$4,$5)",
    [businessId, input.operationId, actorId, digest, result],
  );
  await db.query(
    "INSERT INTO audit_events(business_id,actor_id,action,entity_id,operation_id) VALUES ($1,$2,'bill.cancel',$3,$4)",
    [businessId, actorId, input.billId, input.operationId],
  );
  await db.query(
    "INSERT INTO change_log(business_id,kind,entity_id,version) VALUES ($1,'bill',$2,1)",
    [businessId, input.billId],
  );
  return result;
}
