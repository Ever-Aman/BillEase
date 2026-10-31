import { yearOf } from "../utils/fiscal-year.js";
import { transaction, pool } from "../config.js";
import { buildTaxSnapshot } from "./gst.js";
import { hash } from "../utils/validation.js";

function fail(message, status = 409) {
  throw Object.assign(new Error(message), { status });
}
function serialize(result) {
  return JSON.parse(JSON.stringify(result));
}
export async function allocateReceipt(
  db,
  businessId,
  customerId,
  billId,
  paymentId,
  amount,
  actorId,
) {
  const balance = await db.query(
    "SELECT COALESCE(SUM(debt_delta_minor),0)::text debt FROM customer_ledger WHERE business_id=$1 AND customer_id=$2",
    [businessId, customerId],
  );
  const debt = BigInt(balance.rows[0].debt),
    paid = debt > 0n ? (amount < debt ? amount : debt) : 0n;
  await db.query(
    "INSERT INTO customer_ledger(business_id,customer_id,bill_id,payment_id,debt_delta_minor,advance_delta_minor,actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [
      businessId,
      customerId,
      billId,
      paymentId,
      (-paid).toString(),
      (amount - paid).toString(),
      actorId,
    ],
  );
}

export async function createBill(businessId, actorId, role, input, existingDb) {
  const run = async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [businessId]);
    const digest = hash(input);
    const existing = await db.query(
      "SELECT payload_hash,result FROM operations WHERE business_id=$1 AND operation_id=$2",
      [businessId, input.operationId],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].payload_hash !== digest)
        fail("Operation ID reused with different payload");
      return existing.rows[0].result;
    }
    const occurred = new Date(input.occurrenceAt);
    if (!Number.isFinite(occurred.getTime()))
      fail("Invalid occurrence time", 400);
    const now = new Date();
    if (yearOf(occurred) !== yearOf(now))
      fail("Period boundary needs owner review");
    const business = await db.query(
      "SELECT document_mode,document_profile,profile_version FROM businesses WHERE id=$1",
      [businessId],
    );
    if (
      !["non_gst", "composition", "regular_gst"].includes(
        business.rows[0]?.document_mode,
      )
    )
      fail("Document mode is not active");
    if (!business.rows[0]?.document_profile)
      fail("Document profile required before billing");
    let customerSnapshot = null;
    let balanceSnapshot = { previousDebtMinor: "0", previousAdvanceMinor: "0" };
    if (input.customerId) {
      const customer = await db.query(
        'SELECT id,name,phone,locality,gstin,address,state_code AS "stateCode" FROM customers WHERE business_id=$1 AND id=$2 AND active=true',
        [businessId, input.customerId],
      );
      if (!customer.rowCount) fail("Customer unavailable", 400);
      customerSnapshot = customer.rows[0];
      const balance = await db.query(
        "SELECT COALESCE(SUM(debt_delta_minor),0)::text debt,COALESCE(SUM(advance_delta_minor),0)::text advance FROM customer_ledger WHERE business_id=$1 AND customer_id=$2",
        [businessId, input.customerId],
      );
      balanceSnapshot = {
        previousDebtMinor: balance.rows[0].debt,
        previousAdvanceMinor: balance.rows[0].advance,
      };
    }
    if (input.quotationId) {
      if (role !== "owner") fail("Quotation conversion requires owner", 403);
      const quote = await db.query(
        "SELECT customer_id FROM quotations WHERE business_id=$1 AND id=$2",
        [businessId, input.quotationId],
      );
      if (!quote.rowCount || quote.rows[0].customer_id !== input.customerId)
        fail("Quotation and customer mismatch", 400);
    }
    const lines = [];
    const sharedPrices = new Map();
    let total = 0n;
    for (const line of input.lines) {
      const revision = await db.query(
        "SELECT r.snapshot,i.version current_version,u.price_minor::text current_price_minor FROM catalogue_revisions r LEFT JOIN items i ON i.business_id=r.business_id AND i.id=r.item_id LEFT JOIN item_units u ON u.business_id=r.business_id AND u.item_id=r.item_id AND u.id=$4 WHERE r.business_id=$1 AND r.item_id=$2 AND r.version=$3",
        [businessId, line.itemId, line.catalogueVersion, line.unitId],
      );
      const item = revision.rows[0]?.snapshot;
      if (
        input.quotationId &&
        revision.rows[0]?.current_version !== line.catalogueVersion
      )
        fail(
          "Quotation conversion requires the current catalogue revision; refresh the draft",
          409,
        );
      const selected = item?.units.find(
        (u) => u.id === line.unitId && u.active,
      );
      if (!item?.active || !selected)
        fail("Catalogue revision unavailable", 400);
      const base = BigInt(selected.priceMinor);
      const price =
        line.overridePriceMinor === undefined
          ? base
          : BigInt(line.overridePriceMinor);
      if (price !== base && role !== "owner")
        fail("Price override requires owner", 403);
      const sharedKey = `${item.id}:${selected.id}`;
      if (sharedPrices.has(sharedKey) && sharedPrices.get(sharedKey) !== price)
        fail("Repeated item and unit must use one price", 400);
      sharedPrices.set(sharedKey, price);
      const lineTotal = (price * BigInt(line.quantityMilli) + 500n) / 1000n;
      total += lineTotal;
      lines.push({
        id: line.id,
        taxItem: item,
        itemId: item.id,
        unitId: selected.id,
        version: item.version,
        itemName: item.name,
        unitLabel: selected.label,
        canonicalUnit: item.canonicalUnit,
        factor: selected.factor,
        quantityMilli: line.quantityMilli,
        price,
        lineTotal,
        overrideBy: price === base ? null : actorId,
        difference: price - base,
        catalogueStale: revision.rows[0].current_version !== item.version,
        stalePrice:
          revision.rows[0].current_price_minor === null ||
          BigInt(revision.rows[0].current_price_minor) !== base,
        currentVersion: revision.rows[0].current_version,
        currentPrice: revision.rows[0].current_price_minor,
      });
    }
    const tax = buildTaxSnapshot(
      business.rows[0].document_mode,
      business.rows[0].document_profile,
      customerSnapshot,
      input.placeOfSupply,
      lines.map((l) => ({
        lineId: l.id,
        item: l.taxItem,
        amountMinor: l.lineTotal,
      })),
    );
    if (total === 0n || total > BigInt(Number.MAX_SAFE_INTEGER))
      fail("Bill amount must be positive and within limit", 400);
    const paymentTotal = input.payments.reduce(
      (sum, p) => sum + BigInt(p.amountMinor),
      0n,
    );
    if (paymentTotal > total && (role !== "owner" || !input.customerId))
      fail("Payment exceeds staff or walk-in limit", 400);
    const confirmedPayments = input.payments.filter(
      (payment) => role === "owner" || payment.method === "cash",
    );
    const confirmedTotal = confirmedPayments.reduce(
      (sum, p) => sum + BigInt(p.amountMinor),
      0n,
    );
    if (!input.customerId && confirmedTotal < total)
      fail("Walk-in bill requires confirmed payment", 400);
    const review =
      role === "staff" && confirmedTotal < total
        ? "credit_pending"
        : "not_required";
    const fy = yearOf(now);
    const series = await db.query(
      "UPDATE document_series SET last_number=last_number+1 WHERE business_id=$1 AND financial_year=$2 RETURNING last_number",
      [businessId, fy],
    );
    if (!series.rowCount)
      fail("Document series must be confirmed before billing");
    const number = series.rows[0].last_number;
    await db.query(
      "INSERT INTO bills(id,business_id,customer_id,actor_id,financial_year,invoice_number,total_minor,review_state,occurrence_at,document_snapshot,customer_snapshot,quotation_id,balance_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
      [
        input.id,
        businessId,
        input.customerId,
        actorId,
        fy,
        number,
        total.toString(),
        review,
        occurred,
        {
          ...business.rows[0].document_profile,
          profileVersion: business.rows[0].profile_version,
          layoutRevision: "reference-invoice-v1",
          ...(tax ? { tax } : {}),
        },
        customerSnapshot,
        input.quotationId ?? null,
        balanceSnapshot,
      ],
    );
    for (const l of lines)
      await db.query(
        "INSERT INTO bill_lines(id,business_id,bill_id,item_id,unit_id,catalogue_version,item_name,unit_label,canonical_unit,factor,quantity_milli,unit_price_minor,line_total_minor,price_override_by,price_difference_minor,catalogue_stale,stale_price,current_catalogue_version_at_issue,current_price_minor_at_issue) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)",
        [
          l.id,
          businessId,
          input.id,
          l.itemId,
          l.unitId,
          l.version,
          l.itemName,
          l.unitLabel,
          l.canonicalUnit,
          l.factor,
          l.quantityMilli,
          l.price.toString(),
          l.lineTotal.toString(),
          l.overrideBy,
          l.difference.toString(),
          l.catalogueStale,
          l.stalePrice,
          l.currentVersion,
          l.currentPrice,
        ],
      );
    for (const p of input.payments)
      await db.query(
        "INSERT INTO payments(id,business_id,bill_id,method,amount_minor,state,actor_id,occurrence_at,verified_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          p.id,
          businessId,
          input.id,
          p.method,
          p.amountMinor,
          role === "owner" || p.method === "cash" ? "confirmed" : "pending",
          actorId,
          occurred,
          role === "owner" ? actorId : null,
        ],
      );
    if (
      role === "staff" &&
      (review === "credit_pending" ||
        input.payments.some((payment) => payment.method !== "cash"))
    )
      await db.query(
        "INSERT INTO push_jobs(business_id,user_id,category,reference_id) SELECT $1,m.user_id,'bill_review',$2 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.business_id=$1 AND m.role='owner' AND m.active=true AND u.active=true ON CONFLICT DO NOTHING",
        [businessId, input.id],
      );
    if (input.customerId) {
      await db.query(
        "INSERT INTO customer_ledger(business_id,customer_id,bill_id,debt_delta_minor,actor_id) VALUES ($1,$2,$3,$4,$5)",
        [businessId, input.customerId, input.id, total.toString(), actorId],
      );
      for (const p of confirmedPayments)
        await allocateReceipt(
          db,
          businessId,
          input.customerId,
          input.id,
          p.id,
          BigInt(p.amountMinor),
          actorId,
        );
    }
    const result = serialize({
      id: input.id,
      financialYear: fy,
      invoiceNumber: number,
      totalMinor: total.toString(),
      reviewState: review,
      ...(tax ? { tax } : {}),
      catalogueStale: lines.some((l) => l.catalogueStale),
      stalePrices: lines.some((l) => l.stalePrice),
    });
    await db.query(
      "INSERT INTO operations(business_id,operation_id,operation_type,actor_id,payload_hash,result) VALUES ($1,$2,$3,$4,$5,$6)",
      [businessId, input.operationId, "bill.create", actorId, digest, result],
    );
    await db.query(
      "INSERT INTO audit_events(business_id,actor_id,action,entity_id,operation_id) VALUES ($1,$2,$3,$4,$5)",
      [businessId, actorId, "bill.create", input.id, input.operationId],
    );
    await db.query(
      "INSERT INTO change_log(business_id,kind,entity_id,version) VALUES ($1,$2,$3,1)",
      [businessId, "bill", input.id],
    );
    if (input.customerId)
      await db.query(
        "INSERT INTO change_log(business_id,kind,entity_id,version) VALUES ($1,$2,$3,1)",
        [businessId, "customer_balance", input.customerId],
      );
    return result;
  };
  return existingDb ? run(existingDb) : transaction(run);
}

export async function getBill(businessId, billId, actorId, role) {
  const bill = await pool.query(
    "SELECT * FROM bills WHERE business_id=$1 AND id=$2",
    [businessId, billId],
  );
  if (!bill.rowCount) fail("Bill not found", 404);
  if (role === "staff" && bill.rows[0].actor_id !== actorId)
    fail("Bill access denied", 403);
  const lines = await pool.query(
    "SELECT id,item_id,unit_id,item_name,unit_label,canonical_unit,factor::text,quantity_milli,unit_price_minor::text,line_total_minor::text,catalogue_version,price_override_by,price_difference_minor::text,catalogue_stale,stale_price,current_catalogue_version_at_issue,current_price_minor_at_issue::text FROM bill_lines WHERE business_id=$1 AND bill_id=$2",
    [businessId, billId],
  );
  const payments = await pool.query(
    "SELECT id,method,amount_minor::text,state,corrected_at FROM payments WHERE business_id=$1 AND bill_id=$2",
    [businessId, billId],
  );
  return { bill: bill.rows[0], lines: lines.rows, payments: payments.rows };
}

export async function decidePayment(businessId, actorId, input, existingDb) {
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
      "SELECT p.*,b.customer_id FROM payments p JOIN bills b ON b.business_id=p.business_id AND b.id=p.bill_id WHERE p.business_id=$1 AND p.id=$2 FOR UPDATE OF p",
      [businessId, input.paymentId],
    );
    const payment = rows[0];
    if (!payment || payment.state !== "pending" || payment.corrected_at)
      fail("Payment is not pending");
    const state = input.confirm ? "confirmed" : "rejected";
    await db.query(
      "UPDATE payments SET state=$3,verified_by=$4 WHERE business_id=$1 AND id=$2",
      [businessId, input.paymentId, state, actorId],
    );
    if (input.confirm && payment.customer_id)
      await allocateReceipt(
        db,
        businessId,
        payment.customer_id,
        payment.bill_id,
        payment.id,
        BigInt(payment.amount_minor),
        actorId,
      );
    const result = { paymentId: input.paymentId, state };
    await db.query(
      "INSERT INTO operations(business_id,operation_id,operation_type,actor_id,payload_hash,result) VALUES ($1,$2,$3,$4,$5,$6)",
      [
        businessId,
        input.operationId,
        "payment.verify",
        actorId,
        digest,
        result,
      ],
    );
    await db.query(
      "INSERT INTO audit_events(business_id,actor_id,action,entity_id,operation_id) VALUES ($1,$2,$3,$4,$5)",
      [
        businessId,
        actorId,
        "payment.verify",
        input.paymentId,
        input.operationId,
      ],
    );
    await db.query(
      "INSERT INTO change_log(business_id,kind,entity_id,version) VALUES ($1,$2,$3,1)",
      [businessId, "bill", payment.bill_id],
    );
    if (input.confirm && payment.customer_id)
      await db.query(
        "INSERT INTO change_log(business_id,kind,entity_id,version) VALUES ($1,$2,$3,1)",
        [businessId, "customer_balance", payment.customer_id],
      );
    return result;
  };
  return existingDb ? run(existingDb) : transaction(run);
}

export async function decideCredit(businessId, actorId, input, existingDb) {
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
    const bill = await db.query(
      "SELECT review_state,customer_id,lifecycle FROM bills WHERE business_id=$1 AND id=$2 FOR UPDATE",
      [businessId, input.billId],
    );
    if (!bill.rows[0]?.customer_id || bill.rows[0].lifecycle !== "issued")
      fail("Credit release requires an issued bill for a saved customer");
    if (!input.approve && bill.rows[0].review_state !== "credit_pending")
      fail("Bill has no pending credit review");
    const state = input.approve ? "approved" : "disputed";
    await db.query(
      "UPDATE bills SET review_state=$3 WHERE business_id=$1 AND id=$2",
      [businessId, input.billId, state],
    );
    const result = { billId: input.billId, reviewState: state };
    await db.query(
      "INSERT INTO operations(business_id,operation_id,operation_type,actor_id,payload_hash,result) VALUES ($1,$2,$3,$4,$5,$6)",
      [businessId, input.operationId, "credit.review", actorId, digest, result],
    );
    await db.query(
      "INSERT INTO audit_events(business_id,actor_id,action,entity_id,operation_id) VALUES ($1,$2,$3,$4,$5)",
      [businessId, actorId, "credit.review", input.billId, input.operationId],
    );
    await db.query(
      "INSERT INTO change_log(business_id,kind,entity_id,version) VALUES ($1,$2,$3,1)",
      [businessId, "bill", input.billId],
    );
    return result;
  };
  return existingDb ? run(existingDb) : transaction(run);
}

export async function customerDebt(businessId, customerId) {
  const { rows } = await pool.query(
    "SELECT COALESCE(SUM(debt_delta_minor),0)::text AS debt_minor FROM customer_ledger WHERE business_id=$1 AND customer_id=$2",
    [businessId, customerId],
  );
  return rows[0];
}
