import { pool, transaction } from "../config.js";
import { hash } from "../utils/validation.js";
import { getBill } from "./billing.js";
import { deliveryView } from "./delivery.js";
import { getBalance } from "./finance.js";
import { getQuotation } from "./quotations.js";
export async function listCatalogue(businessId) {
  const { rows } = await pool.query(
    "SELECT id,name,canonical_unit,version,active,hsn,gst_rate_bps,tax_category FROM items WHERE business_id=$1 ORDER BY name LIMIT 500",
    [businessId],
  );
  const ids = rows.map((r) => r.id);
  const units = ids.length
    ? (
        await pool.query(
          "SELECT id,item_id,label,factor::text,price_minor::text,active FROM item_units WHERE business_id=$1 AND item_id=ANY($2::uuid[]) ORDER BY label",
          [businessId, ids],
        )
      ).rows
    : [];
  return rows.map((i) => ({
    id: i.id,
    name: i.name,
    canonicalUnit: i.canonical_unit,
    hsn: i.hsn,
    gstRateBps: i.gst_rate_bps,
    taxCategory: i.tax_category,
    version: i.version,
    active: i.active,
    units: units
      .filter((u) => u.item_id === i.id)
      .map((u) => ({
        id: u.id,
        label: u.label,
        factor: u.factor,
        priceMinor: u.price_minor,
        active: u.active,
      })),
  }));
}
export async function pullChanges(businessId, cursor, actorId, role) {
  const { rows } = await pool.query(
    "SELECT cursor,kind,entity_id,version FROM change_log WHERE business_id=$1 AND cursor>$2 ORDER BY cursor LIMIT 100",
    [businessId, cursor],
  );
  const items = [];
  for (const change of rows) {
    if (change.kind === "quotation") {
      if (role === "owner")
        items.push({
          cursor: String(change.cursor),
          kind: "quotation",
          data: await getQuotation(businessId, change.entity_id),
        });
      continue;
    }
    if (change.kind === "customer_balance") {
      if (role === "owner")
        items.push({
          cursor: String(change.cursor),
          kind: "customer_balance",
          data: {
            customerId: change.entity_id,
            ...(await getBalance(businessId, change.entity_id)),
          },
        });
      continue;
    }
    if (change.kind === "bill") {
      const delivery = await deliveryView(businessId, change.entity_id);
      const data =
        role === "owner"
          ? {
              ...(await getBill(
                businessId,
                change.entity_id,
                actorId,
                "owner",
              )),
              delivery,
            }
          : delivery;
      items.push({ cursor: String(change.cursor), kind: "bill", data });
      continue;
    }
    const statement =
      change.kind === "customer"
        ? "SELECT snapshot FROM customer_revisions WHERE business_id=$1 AND customer_id=$2 AND version=$3"
        : "SELECT snapshot FROM catalogue_revisions WHERE business_id=$1 AND item_id=$2 AND version=$3";
    const { rows: revisions } = await pool.query(statement, [
      businessId,
      change.entity_id,
      change.version,
    ]);
    items.push({
      cursor: String(change.cursor),
      kind: change.kind,
      data: revisions[0]?.snapshot,
    });
  }
  return {
    changes: items,
    nextCursor: rows.length ? String(rows.at(-1).cursor) : String(cursor),
    hasMore: rows.length === 100,
  };
}
export async function upsertItem(
  businessId,
  itemId,
  actorId,
  input,
  sharedDb = null,
) {
  if (
    input.id !== itemId ||
    new Set(input.units.map((u) => u.id)).size !== input.units.length
  )
    throw Object.assign(new Error("Item or unit ID mismatch"), { status: 400 });
  const apply = async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [businessId]);
    const payloadHash = hash(input);
    const oldOp = await db.query(
      "SELECT payload_hash,result,actor_id,operation_type FROM operations WHERE business_id=$1 AND operation_id=$2",
      [businessId, input.operationId],
    );
    if (oldOp.rows[0]) {
      if (
        oldOp.rows[0].payload_hash !== payloadHash ||
        oldOp.rows[0].actor_id !== actorId ||
        oldOp.rows[0].operation_type !== "catalogue.item.upsert"
      ) {
        const e = new Error("Operation ID reused with different payload");
        e.status = 409;
        throw e;
      }
      return oldOp.rows[0].result;
    }
    const current = await db.query(
      "SELECT version,hsn,gst_rate_bps,tax_category FROM items WHERE business_id=$1 AND id=$2 FOR UPDATE",
      [businessId, input.id],
    );
    const version = current.rows[0]?.version;
    if ((version ?? null) !== input.expectedVersion) {
      const e = new Error("Item version conflict");
      e.status = 409;
      throw e;
    }
    const next = (version ?? 0) + 1;
    const tax = {
      hsn: input.hsn ?? current.rows[0]?.hsn ?? null,
      gstRateBps: input.gstRateBps ?? current.rows[0]?.gst_rate_bps ?? null,
      taxCategory: input.taxCategory ?? current.rows[0]?.tax_category ?? null,
    };
    if (version)
      await db.query(
        "UPDATE items SET name=$3,canonical_unit=$4,version=$5,active=$6,updated_at=now() WHERE business_id=$1 AND id=$2",
        [
          businessId,
          input.id,
          input.name,
          input.canonicalUnit,
          next,
          input.active,
        ],
      );
    else
      await db.query(
        "INSERT INTO items(id,business_id,name,canonical_unit,version,active) VALUES ($1,$2,$3,$4,$5,$6)",
        [
          input.id,
          businessId,
          input.name,
          input.canonicalUnit,
          next,
          input.active,
        ],
      );
    await db.query(
      "UPDATE items SET hsn=$3,gst_rate_bps=$4,tax_category=$5 WHERE business_id=$1 AND id=$2",
      [businessId, input.id, tax.hsn, tax.gstRateBps, tax.taxCategory],
    );
    await db.query(
      "DELETE FROM item_units WHERE business_id=$1 AND item_id=$2",
      [businessId, input.id],
    );
    for (const u of input.units)
      await db.query(
        "INSERT INTO item_units(id,business_id,item_id,label,factor,price_minor,active) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [u.id, businessId, input.id, u.label, u.factor, u.priceMinor, u.active],
      );
    const snapshot = {
      ...tax,
      id: input.id,
      name: input.name,
      canonicalUnit: input.canonicalUnit,
      version: next,
      active: input.active,
      units: input.units.map((u) => ({
        ...u,
        priceMinor: String(u.priceMinor),
      })),
    };
    await db.query(
      "INSERT INTO catalogue_revisions(business_id,item_id,version,snapshot,actor_id) VALUES ($1,$2,$3,$4,$5)",
      [businessId, input.id, next, snapshot, actorId],
    );
    const { rows: changes } = await db.query(
      "INSERT INTO change_log(business_id,kind,entity_id,version) VALUES ($1,$2,$3,$4) RETURNING cursor",
      [businessId, "catalogue.item", input.id, next],
    );
    const output = { ...snapshot, cursor: String(changes[0].cursor) };
    await db.query(
      "INSERT INTO operations(business_id,operation_id,operation_type,actor_id,payload_hash,result) VALUES ($1,$2,$3,$4,$5,$6)",
      [
        businessId,
        input.operationId,
        "catalogue.item.upsert",
        actorId,
        payloadHash,
        output,
      ],
    );
    await db.query(
      "INSERT INTO audit_events(business_id,actor_id,action,entity_id,operation_id) VALUES ($1,$2,$3,$4,$5)",
      [
        businessId,
        actorId,
        "catalogue.item.upsert",
        input.id,
        input.operationId,
      ],
    );
    return output;
  };
  return sharedDb ? apply(sharedDb) : transaction(apply);
}
