import { pool, transaction } from "../config.js";
import { buildTaxSnapshot } from "./gst.js";
import { hash } from "../utils/validation.js";
function fail(message, status = 409) {
  throw Object.assign(new Error(message), { status });
}
export async function createQuotation(businessId, actorId, input, existingDb) {
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
    const business = (
      await db.query(
        "SELECT document_profile,profile_version,document_mode FROM businesses WHERE id=$1",
        [businessId],
      )
    ).rows[0];
    if (!business?.document_profile)
      fail("Document profile required before quotation");
    let customerSnapshot = null;
    if (input.customerId) {
      const customer = await db.query(
        'SELECT id,name,phone,locality,gstin,address,state_code AS "stateCode" FROM customers WHERE business_id=$1 AND id=$2 AND active=true',
        [businessId, input.customerId],
      );
      if (!customer.rowCount) fail("Customer unavailable", 400);
      customerSnapshot = customer.rows[0];
    }
    let total = 0n;
    const lines = [];
    for (const line of input.lines) {
      const revision = await db.query(
        "SELECT snapshot FROM catalogue_revisions WHERE business_id=$1 AND item_id=$2 AND version=$3",
        [businessId, line.itemId, line.catalogueVersion],
      );
      const item = revision.rows[0]?.snapshot,
        unit = item?.units.find((u) => u.id === line.unitId);
      if (!item || !unit) fail("Catalogue revision unavailable", 400);
      const price = BigInt(line.priceMinor ?? unit.priceMinor),
        amount = (price * BigInt(line.quantityMilli) + 500n) / 1000n;
      total += amount;
      lines.push({ line, item, unit, price, amount });
    }
    const tax = buildTaxSnapshot(
      business.document_mode,
      business.document_profile,
      customerSnapshot,
      input.placeOfSupply,
      lines.map((l) => ({
        lineId: l.line.id,
        item: l.item,
        amountMinor: l.amount,
      })),
    );
    if (total > BigInt(Number.MAX_SAFE_INTEGER))
      fail("Quotation amount too large", 400);
    await db.query(
      "INSERT INTO quotations(id,business_id,actor_id,customer_id,reference,total_minor,document_snapshot,customer_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        input.id,
        businessId,
        actorId,
        input.customerId,
        input.reference,
        total.toString(),
        {
          ...business.document_profile,
          profileVersion: business.profile_version,
          layoutRevision: "reference-quotation-v1",
          ...(tax ? { tax } : {}),
        },
        customerSnapshot,
      ],
    );
    for (const { line, item, unit, price, amount } of lines)
      await db.query(
        "INSERT INTO quotation_lines(id,business_id,quotation_id,item_id,unit_id,catalogue_version,item_name,unit_label,quantity_milli,price_minor,line_total_minor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [
          line.id,
          businessId,
          input.id,
          item.id,
          unit.id,
          item.version,
          item.name,
          unit.label,
          line.quantityMilli,
          price.toString(),
          amount.toString(),
        ],
      );
    const result = {
      id: input.id,
      reference: input.reference,
      ...(tax ? { tax } : {}),
      totalMinor: total.toString(),
    };
    await db.query(
      "INSERT INTO operations(business_id,operation_id,operation_type,actor_id,payload_hash,result) VALUES ($1,$2,$3,$4,$5,$6)",
      [
        businessId,
        input.operationId,
        "quotation.create",
        actorId,
        digest,
        result,
      ],
    );
    await db.query(
      "INSERT INTO audit_events(business_id,actor_id,action,entity_id,operation_id) VALUES ($1,$2,$3,$4,$5)",
      [businessId, actorId, "quotation.create", input.id, input.operationId],
    );
    await db.query(
      "INSERT INTO change_log(business_id,kind,entity_id,version) VALUES ($1,'quotation',$2,1)",
      [businessId, input.id],
    );
    return result;
  };
  return existingDb ? run(existingDb) : transaction(run);
}
export async function quotationDraft(businessId, quotationId) {
  const q = await pool.query(
    "SELECT id,reference,customer_id,document_snapshot FROM quotations WHERE business_id=$1 AND id=$2",
    [businessId, quotationId],
  );
  if (!q.rowCount) fail("Quotation not found", 404);
  const lines = await pool.query(
    "SELECT l.item_id,l.unit_id,l.catalogue_version,l.quantity_milli,l.price_minor::text,l.item_name,l.unit_label,u.price_minor::text current_price_minor,i.version current_version,(i.active AND u.active) catalogue_available FROM quotation_lines l LEFT JOIN items i ON i.business_id=l.business_id AND i.id=l.item_id LEFT JOIN item_units u ON u.business_id=l.business_id AND u.id=l.unit_id AND u.item_id=l.item_id WHERE l.business_id=$1 AND l.quotation_id=$2 ORDER BY l.id",
    [businessId, quotationId],
  );
  return {
    quotationId,
    placeOfSupply: q.rows[0].document_snapshot?.tax?.placeOfSupply,
    customerId: q.rows[0].customer_id,
    reference: q.rows[0].reference,
    lines: lines.rows.map((l) => ({
      itemId: l.item_id,
      unitId: l.unit_id,
      catalogueVersion: l.current_version ?? l.catalogue_version,
      quotedCatalogueVersion: l.catalogue_version,
      catalogueChanged: l.current_version !== l.catalogue_version,
      quantityMilli: l.quantity_milli,
      overridePriceMinor: Number(l.price_minor),
      itemName: l.item_name,
      unitLabel: l.unit_label,
      currentPriceMinor: l.current_price_minor,
      priceChanged: l.current_price_minor !== l.price_minor,
      catalogueAvailable: l.catalogue_available === true,
    })),
    state: "draft",
  };
}

export async function getQuotation(businessId, quotationId) {
  const quotation = (
    await pool.query(
      "SELECT * FROM quotations WHERE business_id=$1 AND id=$2",
      [businessId, quotationId],
    )
  ).rows[0];
  if (!quotation) fail("Quotation not found", 404);
  const lines = (
    await pool.query(
      "SELECT id,item_id,unit_id,catalogue_version,item_name,unit_label,quantity_milli,price_minor::text,line_total_minor::text FROM quotation_lines WHERE business_id=$1 AND quotation_id=$2 ORDER BY id",
      [businessId, quotationId],
    )
  ).rows;
  return { quotation, lines };
}
export async function listQuotations(businessId, afterId = null) {
  const rows = (
    await pool.query(
      "SELECT id,reference,customer_id,total_minor::text,created_at FROM quotations WHERE business_id=$1 AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT 101",
      [businessId, afterId],
    )
  ).rows;
  const quotations = rows.slice(0, 100);
  return {
    quotations,
    nextCursor: quotations.at(-1)?.id ?? afterId,
    hasMore: rows.length > 100,
  };
}
