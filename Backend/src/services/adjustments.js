import { adjustmentTaxSnapshot } from "../utils/adjustment-tax.js";

function fail(message, status = 409) {
  throw Object.assign(new Error(message), { status });
}

// Saved conversions and valuation use PostgreSQL decimal arithmetic.
export async function adjustmentLine(db, businessId, billId, input, kind) {
  const { rows } = await db.query(
    "SELECT l.*,b.customer_id,b.lifecycle,b.document_snapshot,b.invoice_number,b.financial_year,q.* FROM bill_lines l JOIN bills b ON b.business_id=l.business_id AND b.id=l.bill_id JOIN bill_line_quantities q ON q.business_id=l.business_id AND q.line_id=l.id WHERE l.business_id=$1 AND l.bill_id=$2 AND l.id=$3",
    [businessId, billId, input.lineId],
  );
  const line = rows[0];
  if (!line || line.lifecycle !== "issued") fail("Bill line unavailable", 404);
  const revision = await db.query(
    "SELECT snapshot FROM catalogue_revisions WHERE business_id=$1 AND item_id=$2 AND version=$3",
    [businessId, line.item_id, line.catalogue_version],
  );
  const unit = revision.rows[0]?.snapshot?.units.find(
    (x) => x.id === (input.unitId ?? line.unit_id),
  );
  if (!unit) fail("Unit unavailable in original bill revision", 400);
  const computed = await db.query(
    `SELECT COALESCE($1::numeric,$2::numeric*$3::numeric/1000)::numeric(24,9)::text quantity,
      CASE WHEN $4='return' THEN LEAST($5::numeric-$6::numeric-$7::numeric,$8::numeric-$6::numeric)
        ELSE $5::numeric-$8::numeric-$7::numeric END AS allowed`,
    [
      input.canonicalQuantity ?? null,
      unit.factor,
      input.quantityMilli ?? null,
      kind,
      line.billed_canonical,
      line.returned_canonical,
      line.cancelled_canonical,
      line.delivered_canonical,
    ],
  );
  const quantity = computed.rows[0].quantity;
  const valuation = await db.query(
    `SELECT ($1::numeric>0 AND $1::numeric<=$2::numeric) permitted,
      GREATEST(0,LEAST($3::bigint-$4::bigint,
        ROUND($3::numeric*($5::numeric+$6::numeric+$1::numeric)/$7::numeric)-$4::bigint))::bigint::text value,
      ($1::numeric*1000/$8::numeric)::text entered_milli`,
    [
      quantity,
      computed.rows[0].allowed,
      line.line_total_minor,
      line.adjusted_value_minor,
      line.returned_canonical,
      line.cancelled_canonical,
      line.billed_canonical,
      unit.factor,
    ],
  );
  if (!valuation.rows[0].permitted)
    fail(
      kind === "return"
        ? "Return exceeds eligible delivered quantity"
        : "Cancellation exceeds undelivered quantity",
    );
  const value = BigInt(valuation.rows[0].value);
  const previous = line.document_snapshot?.tax
    ? (
        await db.query(
          "SELECT tax_snapshot FROM returns WHERE business_id=$1 AND line_id=$2 UNION ALL SELECT tax_snapshot FROM line_cancellations WHERE business_id=$1 AND line_id=$2",
          [businessId, line.id],
        )
      ).rows
    : [];
  const taxSnapshot = adjustmentTaxSnapshot({ line, value, previous });
  return {
    line,
    taxSnapshot,
    unit,
    quantity,
    value,
    enteredMilli: valuation.rows[0].entered_milli,
  };
}

export async function settleAdjustment(
  db,
  businessId,
  actorId,
  customerId,
  input,
  value,
) {
  let debtReduction = 0n;
  if (customerId) {
    const balance = await db.query(
      "SELECT GREATEST(COALESCE(SUM(debt_delta_minor),0),0)::text debt FROM customer_ledger WHERE business_id=$1 AND customer_id=$2",
      [businessId, customerId],
    );
    const debt = BigInt(balance.rows[0].debt);
    debtReduction = debt < value ? debt : value;
  }
  const excess = value - debtReduction;
  if (excess > 0n) {
    if (!["advance", "refund"].includes(input.resolution))
      fail("Choose refund or advance for the entire excess", 400);
    if (!customerId && input.resolution !== "refund")
      fail("Walk-in adjustment requires refund", 400);
    if (input.resolution === "refund") {
      if (!input.refundId || !input.refundMethod)
        fail("Refund ID and method required", 400);
      await db.query(
        "INSERT INTO refunds(id,business_id,bill_id,amount_minor,method,actor_id,reason) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [
          input.refundId,
          businessId,
          input.billId,
          excess.toString(),
          input.refundMethod,
          actorId,
          input.reason,
        ],
      );
    }
  }
  if (customerId) {
    await db.query(
      "INSERT INTO customer_ledger(business_id,customer_id,bill_id,debt_delta_minor,advance_delta_minor,actor_id,note) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [
        businessId,
        customerId,
        input.billId,
        (-debtReduction).toString(),
        input.resolution === "advance" ? excess.toString() : "0",
        actorId,
        input.reason,
      ],
    );
    await db.query(
      "INSERT INTO change_log(business_id,kind,entity_id,version) VALUES ($1,'customer_balance',$2,1)",
      [businessId, customerId],
    );
  }
  return {
    debtReducedMinor: debtReduction.toString(),
    excessMinor: excess.toString(),
    resolution: excess > 0n ? input.resolution : "debt",
  };
}
