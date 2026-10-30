import { transaction } from "../config.js";
import { hash } from "../utils/validation.js";
import { toNanos, fromNanos, min, max, ceilDivide } from "../utils/decimal.js";

export async function deliveryAuthorization(businessId, billId) {
  return transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [businessId]);
    return deliveryAuthorizationInTransaction(db, businessId, billId);
  });
}
export async function deliveryAuthorizationInTransaction(
  db,
  businessId,
  billId,
) {
  const bill = (
    await db.query(
      "SELECT customer_id,review_state,lifecycle FROM bills WHERE business_id=$1 AND id=$2",
      [businessId, billId],
    )
  ).rows[0];
  if (!bill)
    throw Object.assign(new Error("Bill unavailable"), { status: 404 });
  const financial = (
    await db.query(
      `SELECT EXISTS(SELECT 1 FROM payments WHERE business_id=$1 AND bill_id=$2 AND method<>'cash' AND state<>'confirmed' AND corrected_at IS NULL) unverified,
      ((SELECT COALESCE(SUM(amount_minor),0) FROM payments WHERE business_id=$1 AND bill_id=$2 AND state='confirmed' AND corrected_at IS NULL)
      -(SELECT COALESCE(SUM(advance_delta_minor),0) FROM customer_ledger WHERE business_id=$1 AND bill_id=$2)
      -(SELECT COALESCE(SUM(amount_minor),0) FROM refunds WHERE business_id=$1 AND bill_id=$2))::text covered`,
      [businessId, billId],
    )
  ).rows[0];
  const ownerCreditRelease = Boolean(
    bill.customer_id &&
    bill.review_state === "approved" &&
    bill.lifecycle === "issued",
  );
  const gateRequired =
    bill.lifecycle !== "issued" ||
    (!ownerCreditRelease && (financial.unverified || !bill.customer_id));
  const { rows } = await db.query(
    "SELECT q.*,l.line_total_minor::text FROM bill_line_quantities q JOIN bill_lines l ON l.business_id=q.business_id AND l.id=q.line_id WHERE q.business_id=$1 AND q.bill_id=$2 ORDER BY q.line_id",
    [businessId, billId],
  );
  let available = max(BigInt(financial.covered), 0n);
  const quantities = rows.map((line) => {
    const billed = toNanos(line.billed_canonical),
      delivered = toNanos(line.delivered_canonical),
      returned = toNanos(line.returned_canonical),
      cancelled = toNanos(line.cancelled_canonical),
      price = BigInt(line.line_total_minor);
    const retained = min(
      max(delivered - returned, 0n),
      max(billed - returned - cancelled, 0n),
    );
    available -= ceilDivide(price * retained, billed);
    return {
      lineId: line.line_id,
      billed,
      delivered,
      price,
      pending: max(billed - delivered - cancelled, 0n),
    };
  });
  available = max(available, 0n);
  const lines = quantities.map((line) => {
    let allowed = line.pending;
    if (bill.lifecycle !== "issued") allowed = 0n;
    else if (gateRequired && line.price > 0n) {
      allowed = min(allowed, (available * line.billed) / line.price);
      available = max(
        available - ceilDivide(allowed * line.price, line.billed),
        0n,
      );
    }
    return {
      lineId: line.lineId,
      permittedAdditionalCanonical: fromNanos(allowed),
      maximumCumulativeCanonical: fromNanos(line.delivered + allowed),
    };
  });
  const permission = { billId, gateRequired, ownerCreditRelease, lines };
  const revision = hash(permission);
  await db.query(
    "INSERT INTO delivery_authorizations(business_id,bill_id,revision,permissions) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
    [businessId, billId, revision, permission],
  );
  return { ...permission, revision };
}
