import { initializeDocumentSeries } from "../../src/services/settings.js";
import { yearOf } from "../../src/utils/fiscal-year.js";
import { randomUUID } from "node:crypto";
import { pool } from "../../src/config.js";
import { createBill } from "../../src/services/billing.js";

export async function saleFixture({
  cash = 0,
  digital = 0,
  quantityMilli = 2000,
  priorDebt = 0,
  lastNumber = 0,
  role = "owner",
} = {}) {
  const ids = Object.fromEntries(
    [
      "business",
      "owner",
      "staff",
      "customer",
      "item",
      "box",
      "piece",
      "bill",
      "line",
    ].map((x) => [x, randomUUID()]),
  );
  await pool.query(
    "INSERT INTO users(id,email,password_hash) VALUES ($1,$2,'test'),($3,$4,'test')",
    [
      ids.owner,
      `${ids.owner}@example.com`,
      ids.staff,
      `${ids.staff}@example.com`,
    ],
  );
  await pool.query(
    "INSERT INTO businesses(id,name,document_mode,document_profile) VALUES ($1,'Test','non_gst',$2)",
    [
      ids.business,
      { name: "Supplier", address: "Test address", phone: "1234567890" },
    ],
  );
  await pool.query(
    "INSERT INTO memberships(user_id,business_id,role) VALUES ($1,$3,'owner'),($2,$3,'staff')",
    [ids.owner, ids.staff, ids.business],
  );
  await pool.query(
    "INSERT INTO customers(id,business_id,name,phone,locality) VALUES ($1,$2,'Customer','1234567890','Test')",
    [ids.customer, ids.business],
  );
  await pool.query(
    "INSERT INTO items(id,business_id,name,canonical_unit) VALUES ($1,$2,'Item','piece')",
    [ids.item, ids.business],
  );
  const item = {
    id: ids.item,
    name: "Item",
    canonicalUnit: "piece",
    version: 1,
    active: true,
    units: [
      {
        id: ids.box,
        label: "box",
        factor: "10",
        priceMinor: "1000",
        active: true,
      },
      {
        id: ids.piece,
        label: "piece",
        factor: "1",
        priceMinor: "200",
        active: true,
      },
    ],
  };
  for (const unit of item.units)
    await pool.query(
      "INSERT INTO item_units(id,business_id,item_id,label,factor,price_minor) VALUES ($1,$2,$3,$4,$5,$6)",
      [
        unit.id,
        ids.business,
        ids.item,
        unit.label,
        unit.factor,
        unit.priceMinor,
      ],
    );
  await pool.query(
    "INSERT INTO catalogue_revisions(business_id,item_id,version,snapshot,actor_id) VALUES ($1,$2,1,$3,$4)",
    [ids.business, ids.item, item, ids.owner],
  );
  await initializeDocumentSeries(ids.business, ids.owner, {
    financialYear: yearOf(new Date()),
    lastNumber,
    operationId: randomUUID(),
  });
  const payments = [];
  if (priorDebt)
    await pool.query(
      "INSERT INTO customer_ledger(business_id,customer_id,debt_delta_minor,actor_id,note) VALUES ($1,$2,$3,$4,'Opening debt')",
      [ids.business, ids.customer, priorDebt, ids.owner],
    );
  if (cash)
    payments.push({ id: randomUUID(), method: "cash", amountMinor: cash });
  if (digital)
    payments.push({ id: randomUUID(), method: "upi", amountMinor: digital });
  await createBill(ids.business, ids[role], role, {
    id: ids.bill,
    customerId: ids.customer,
    occurrenceAt: new Date().toISOString(),
    operationId: randomUUID(),
    lines: [
      {
        id: ids.line,
        itemId: ids.item,
        unitId: ids.box,
        catalogueVersion: 1,
        quantityMilli,
      },
    ],
    payments,
  });
  return ids;
}
