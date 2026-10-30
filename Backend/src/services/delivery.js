import { pool, transaction } from "../config.js";
import { hash } from "../utils/validation.js";
import {
  deliveryAuthorization,
  deliveryAuthorizationInTransaction,
} from "./delivery-authorization.js";
import { toNanos } from "../utils/decimal.js";
function fail(message, status = 409) {
  throw Object.assign(new Error(message), { status });
}
export async function deliveryView(businessId, billId) {
  const bill = await pool.query(
    "SELECT b.id,b.invoice_number,b.financial_year,b.issued_at,b.customer_id,b.review_state,b.lifecycle,c.name customer_name,c.phone customer_phone,c.locality customer_locality FROM bills b LEFT JOIN customers c ON c.business_id=b.business_id AND c.id=b.customer_id WHERE b.business_id=$1 AND b.id=$2",
    [businessId, billId],
  );
  if (!bill.rowCount) fail("Bill not found", 404);
  const lines = await pool.query(
    "SELECT l.id,l.item_id,l.unit_id,l.catalogue_version,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',u->>'id','label',u->>'label','factor',u->>'factor')) FROM catalogue_revisions r CROSS JOIN LATERAL jsonb_array_elements(r.snapshot->'units') u WHERE r.business_id=l.business_id AND r.item_id=l.item_id AND r.version=l.catalogue_version),'[]'::jsonb) units,l.item_name,l.unit_label,l.canonical_unit,l.factor::text,l.quantity_milli,q.billed_canonical::text,q.delivered_canonical::text,q.returned_canonical::text,q.cancelled_canonical::text,GREATEST(q.billed_canonical-q.delivered_canonical-q.cancelled_canonical,0)::text pending_canonical,GREATEST(q.delivered_canonical+q.cancelled_canonical-q.billed_canonical,0)::text excess_canonical FROM bill_lines l JOIN bill_line_quantities q ON q.business_id=l.business_id AND q.line_id=l.id WHERE l.business_id=$1 AND l.bill_id=$2",
    [businessId, billId],
  );
  const events = await pool.query(
    "SELECT id,line_id,quantity_milli,unit_label,factor::text,canonical_quantity::text,actor_id,state,occurrence_at,received_at,coverage_conflict FROM delivery_events WHERE business_id=$1 AND bill_id=$2 ORDER BY received_at",
    [businessId, billId],
  );
  return {
    bill: bill.rows[0],
    lines: lines.rows,
    events: events.rows,
    authorization: await deliveryAuthorization(businessId, billId),
  };
}
export async function recordDelivery(
  businessId,
  actorId,
  role,
  input,
  existingDb,
) {
  const run = async (db) => {
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
    const { rows } = await db.query(
      "SELECT b.review_state,b.lifecycle,b.customer_id,l.item_id,l.catalogue_version,l.quantity_milli,l.factor FROM bill_lines l JOIN bills b ON b.business_id=l.business_id AND b.id=l.bill_id WHERE l.business_id=$1 AND l.id=$2 AND l.bill_id=$3",
      [businessId, input.lineId, input.billId],
    );
    const line = rows[0];
    if (!line || (line.lifecycle !== "issued" && !input.authorizationRevision))
      fail("Bill line unavailable", 404);
    const revision = await db.query(
      "SELECT snapshot FROM catalogue_revisions WHERE business_id=$1 AND item_id=$2 AND version=$3",
      [businessId, line.item_id, line.catalogue_version],
    );
    const unit = revision.rows[0]?.snapshot?.units.find(
      (u) => u.id === input.unitId,
    );
    if (!unit) fail("Delivery unit unavailable in bill revision", 400);
    const factor = unit.factor;
    const canonical = await db.query(
      "SELECT ($1::numeric*$2::numeric/1000)::numeric(24,9) amount",
      [factor, input.quantityMilli],
    );
    const authorization = await deliveryAuthorizationInTransaction(
      db,
      businessId,
      input.billId,
    );
    const current = authorization.lines.find((x) => x.lineId === input.lineId);
    let coverageConflict = false;
    if (
      authorization.gateRequired &&
      toNanos(canonical.rows[0].amount) >
        toNanos(current.permittedAdditionalCanonical)
    ) {
      const cached = input.authorizationRevision
        ? (
            await db.query(
              "SELECT permissions FROM delivery_authorizations WHERE business_id=$1 AND bill_id=$2 AND revision=$3",
              [businessId, input.billId, input.authorizationRevision],
            )
          ).rows[0]?.permissions
        : null;
      const cachedLine = cached?.lines.find((x) => x.lineId === input.lineId);
      if (
        !cachedLine ||
        toNanos(canonical.rows[0].amount) >
          toNanos(cachedLine.permittedAdditionalCanonical)
      )
        fail(
          "Delivery exceeds confirmed financial coverage; owner credit release required",
        );
      coverageConflict = true;
    }
    const state = coverageConflict
      ? "disputed"
      : role === "owner"
        ? "accepted"
        : "review_pending";
    await db.query(
      "INSERT INTO delivery_events(id,business_id,bill_id,line_id,quantity_milli,unit_label,factor,canonical_quantity,actor_id,state,occurrence_at,authorization_revision,coverage_conflict) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
      [
        input.id,
        businessId,
        input.billId,
        input.lineId,
        input.quantityMilli,
        unit.label,
        factor,
        canonical.rows[0].amount,
        actorId,
        state,
        input.occurrenceAt,
        input.authorizationRevision ?? authorization.revision,
        coverageConflict,
      ],
    );
    const totals = await db.query(
      "SELECT (COALESCE((SELECT SUM(canonical_quantity) FROM delivery_events WHERE business_id=$1 AND line_id=$2),0)-COALESCE((SELECT SUM(c.canonical_reversal) FROM delivery_corrections c JOIN delivery_events e ON e.business_id=c.business_id AND e.id=c.delivery_id WHERE e.business_id=$1 AND e.line_id=$2),0))::text delivered",
      [businessId, input.lineId],
    );
    const billed = await db.query(
      "SELECT billed_canonical-cancelled_canonical amount FROM bill_line_quantities WHERE business_id=$1 AND line_id=$2",
      [businessId, input.lineId],
    );
    const excess = await db.query(
      "SELECT GREATEST($1::numeric-$2::numeric,0)::text amount",
      [totals.rows[0].delivered, billed.rows[0].amount],
    );
    const result = {
      id: input.id,
      lineId: input.lineId,
      deliveredCanonical: totals.rows[0].delivered,
      excessCanonical: excess.rows[0].amount,
      state,
      coverageConflict,
    };
    await db.query(
      "INSERT INTO operations(business_id,operation_id,operation_type,actor_id,payload_hash,result) VALUES ($1,$2,$3,$4,$5,$6)",
      [
        businessId,
        input.operationId,
        "delivery.record",
        actorId,
        digest,
        result,
      ],
    );
    await db.query(
      "INSERT INTO audit_events(business_id,actor_id,action,entity_id,operation_id) VALUES ($1,$2,$3,$4,$5)",
      [businessId, actorId, "delivery.record", input.id, input.operationId],
    );
    await db.query(
      "INSERT INTO change_log(business_id,kind,entity_id,version) VALUES ($1,$2,$3,1)",
      [businessId, "bill", input.billId],
    );
    return result;
  };
  return existingDb ? run(existingDb) : transaction(run);
}
export async function reviewDelivery(businessId, actorId, input, existingDb) {
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
    const event = await db.query(
      "UPDATE delivery_events SET state=$3 WHERE business_id=$1 AND id=$2 AND state=$4 RETURNING id,bill_id",
      [
        businessId,
        input.id,
        input.accept ? "accepted" : "disputed",
        "review_pending",
      ],
    );
    if (!event.rowCount) fail("Delivery event not pending");
    const result = {
      id: input.id,
      state: input.accept ? "accepted" : "disputed",
    };
    await db.query(
      "INSERT INTO operations(business_id,operation_id,operation_type,actor_id,payload_hash,result) VALUES ($1,$2,$3,$4,$5,$6)",
      [
        businessId,
        input.operationId,
        "delivery.review",
        actorId,
        digest,
        result,
      ],
    );
    await db.query(
      "INSERT INTO audit_events(business_id,actor_id,action,entity_id,operation_id) VALUES ($1,$2,$3,$4,$5)",
      [businessId, actorId, "delivery.review", input.id, input.operationId],
    );
    await db.query(
      "INSERT INTO change_log(business_id,kind,entity_id,version) VALUES ($1,$2,$3,1)",
      [businessId, "bill", event.rows[0].bill_id],
    );
    return result;
  };
  return existingDb ? run(existingDb) : transaction(run);
}
