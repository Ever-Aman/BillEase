import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../src/config.js";
import { buildTaxSnapshot, validGstin } from "../src/services/gst.js";
import { saleFixture } from "./helpers/fixtures.js";
import { createBill, getBill } from "../src/services/billing.js";
import { upsertItem, listCatalogue } from "../src/services/catalogue.js";
import { upsertCustomer, listCustomers } from "../src/services/customers.js";
import {
  createQuotation,
  quotationDraft,
  getQuotation,
} from "../src/services/quotations.js";
import { createBusiness, businessesForUser } from "../src/services/accounts.js";
if (
  process.env.APP_ENV !== "development" ||
  !new URL(process.env.DATABASE_URL).pathname.includes("_tdd_")
)
  throw new Error("Isolated development database required");
const profile = {
  name: "Supplier",
  address: "Mumbai",
  phone: "1234567890",
  signatory: "Owner",
  gstin: "27AAPFU0939F1ZV",
  stateCode: "27",
};
const item = { hsn: "1001", gstRateBps: 1800, taxCategory: "taxable" };
const calc = (
  amountMinor = "11800",
  pos = "27",
  mode = "regular_gst",
  override = {},
) =>
  buildTaxSnapshot(mode, profile, null, pos, [
    { lineId: "line", item: { ...item, ...override }, amountMinor },
  ]);
test("inclusive GST extracts once per line using integer paise and deterministic component split", () => {
  assert.equal(validGstin(profile.gstin), true);
  assert.equal(validGstin("27AAPFU0939F1ZA"), false);
  const t = calc();
  assert.equal(t.totalMinor, "11800");
  assert.equal(t.subtotalMinor, "10000");
  assert.equal(t.cgstMinor, "900");
  assert.equal(t.sgstMinor, "900");
  assert.equal(t.igstMinor, "0");
  assert.equal(t.documentType, "tax_invoice");
  const inter = calc("11800", "29");
  assert.equal(inter.igstMinor, "1800");
  assert.equal(inter.cgstMinor, "0");
  const one = calc("4");
  assert.equal(one.cgstMinor, "1");
  assert.equal(one.sgstMinor, "0");
  for (let amount = 1n; amount < 1000n; amount++) {
    const t = calc(String(amount));
    assert.equal(
      BigInt(t.subtotalMinor) + BigInt(t.cgstMinor) + BigInt(t.sgstMinor),
      amount,
    );
  }
});
test("GST rejects incomplete and unsupported supplies; composition/nil/exempt collect no GST", () => {
  assert.throws(
    () => buildTaxSnapshot("regular_gst", profile, null, undefined, []),
    /place of supply/,
  );
  assert.throws(
    () =>
      buildTaxSnapshot(
        "regular_gst",
        { ...profile, stateCode: "29" },
        null,
        "29",
        [],
      ),
    /GSTIN must match/,
  );
  assert.equal(calc("11800", "04").igstMinor, "1800");
  const prefix = "04" + profile.gstin.slice(2, 14);
  const utGstin = [..."0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"]
    .map((c) => prefix + c)
    .find(validGstin);
  assert.throws(
    () =>
      buildTaxSnapshot(
        "regular_gst",
        { ...profile, gstin: utGstin, stateCode: "04" },
        null,
        "04",
        [{ lineId: "x", item, amountMinor: "11800" }],
      ),
    /UTGST/,
  );
  assert.throws(
    () => calc("11800", "29", "composition"),
    /Interstate composition/,
  );
  assert.throws(() => calc("11800", "27", "regular_gst", { hsn: null }), /HSN/);
  assert.throws(
    () => calc("11800", "27", "regular_gst", { gstRateBps: null }),
    /Explicit GST/,
  );
  assert.throws(
    () => calc("11800", "27", "regular_gst", { taxCategory: "exempt" }),
    /zero/,
  );
  assert.equal(calc("11800", "27", "composition").cgstMinor, "0");
  for (const category of ["nil_rated", "exempt"]) {
    const t = calc("11800", "27", "regular_gst", {
      taxCategory: category,
      gstRateBps: 0,
    });
    assert.equal(t.subtotalMinor, "11800");
    assert.equal(t.taxableMinor, "0");
    assert.equal(t.documentType, "bill_of_supply");
  }
});
test("composition snapshots HSN without inventing a tax rate; mixed and high-value rules are explicit", () => {
  const composition = buildTaxSnapshot("composition", profile, null, "27", [
    { lineId: "x", item: { hsn: "1001" }, amountMinor: "11800" },
  ]);
  assert.equal(composition.lines[0].gstRateBps, null);
  assert.equal(composition.lines[0].taxCategory, null);
  assert.equal(composition.totalMinor, "11800");
  assert.equal(composition.cgstMinor, "0");
  const mixed = [
    { lineId: "x", item, amountMinor: "11800" },
    {
      lineId: "y",
      item: { hsn: "1002", taxCategory: "exempt", gstRateBps: 0 },
      amountMinor: "5000",
    },
  ];
  assert.equal(
    buildTaxSnapshot("regular_gst", profile, null, "27", mixed).documentType,
    "invoice_cum_bill_of_supply",
  );
  assert.throws(
    () =>
      buildTaxSnapshot(
        "regular_gst",
        profile,
        { gstin: profile.gstin, address: "A", stateCode: "27" },
        "27",
        mixed,
      ),
    /Mixed taxable/,
  );
  assert.throws(() => calc("5000000"), /Recipient name/);
});
async function gstFixture(mode = "regular_gst") {
  const f = await saleFixture();
  await pool.query(
    "UPDATE businesses SET document_mode=$2,document_profile=$3 WHERE id=$1",
    [f.business, mode, profile],
  );
  const current = (await listCatalogue(f.business))[0];
  await upsertItem(f.business, f.item, f.owner, {
    ...current,
    ...item,
    units: current.units.map((u) => ({ ...u, priceMinor: 11800 })),
    expectedVersion: 1,
    operationId: randomUUID(),
  });
  return f;
}
const billInput = (f) => ({
  id: randomUUID(),
  customerId: f.customer,
  placeOfSupply: "27",
  occurrenceAt: new Date().toISOString(),
  operationId: randomUUID(),
  lines: [
    {
      id: randomUUID(),
      itemId: f.item,
      unitId: f.box,
      catalogueVersion: 2,
      quantityMilli: 1000,
    },
  ],
  payments: [],
});
test("metadata survives legacy edits and catalogue/customer snapshots preserve exact tax fields", async () => {
  const f = await gstFixture();
  let current = (await listCatalogue(f.business))[0];
  assert.equal(current.hsn, "1001");
  assert.equal(current.gstRateBps, 1800);
  const { hsn, gstRateBps, taxCategory, ...legacy } = current;
  await upsertItem(f.business, f.item, f.owner, {
    ...legacy,
    expectedVersion: 2,
    operationId: randomUUID(),
  });
  current = (await listCatalogue(f.business))[0];
  assert.equal(current.hsn, "1001");
  assert.equal(current.gstRateBps, 1800);
  const payload = {
    id: f.customer,
    name: "Customer",
    phone: "1234567890",
    locality: "Mumbai",
    gstin: profile.gstin,
    address: "Customer address",
    stateCode: "27",
    active: true,
    expectedVersion: 1,
    operationId: randomUUID(),
  };
  await upsertCustomer(f.business, f.owner, payload);
  const { gstin, address, stateCode, ...old } = payload;
  await upsertCustomer(f.business, f.owner, {
    ...old,
    expectedVersion: 2,
    operationId: randomUUID(),
  });
  const customer = (await listCustomers(f.business))[0];
  assert.equal(customer.gstin, profile.gstin);
  assert.equal(customer.address, address);
  assert.equal(customer.stateCode, "27");
});
test("bill snapshot is immutable and idempotent; missing POS rolls back series allocation", async () => {
  const f = await gstFixture(),
    input = billInput(f),
    result = await createBill(f.business, f.owner, "owner", input);
  assert.equal(result.tax.cgstMinor, "900");
  assert.deepEqual(
    await createBill(f.business, f.owner, "owner", input),
    result,
  );
  const detail = await getBill(f.business, result.id, f.owner, "owner");
  assert.equal(detail.bill.document_snapshot.tax.totalMinor, "11800");
  await pool.query("UPDATE businesses SET document_profile=$2 WHERE id=$1", [
    f.business,
    { ...profile, name: "Changed" },
  ]);
  assert.equal(
    (await getBill(f.business, result.id, f.owner, "owner")).bill
      .document_snapshot.name,
    "Supplier",
  );
  const invalid = billInput(f);
  delete invalid.placeOfSupply;
  await assert.rejects(
    () => createBill(f.business, f.owner, "owner", invalid),
    /place of supply/,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT last_number FROM document_series WHERE business_id=$1",
        [f.business],
      )
    ).rows[0].last_number,
    2,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT SUM(debt_delta_minor)::text total FROM customer_ledger WHERE business_id=$1",
        [f.business],
      )
    ).rows[0].total,
    "13800",
  );
});
test("quotation keeps original tax while conversion draft uses current validated catalogue and warnings", async () => {
  const f = await gstFixture(),
    b = billInput(f),
    quote = {
      id: randomUUID(),
      reference: "Q1",
      customerId: f.customer,
      placeOfSupply: "29",
      operationId: randomUUID(),
      lines: b.lines,
    };
  const result = await createQuotation(f.business, f.owner, quote);
  assert.equal(result.tax.igstMinor, "1800");
  const current = (await listCatalogue(f.business))[0];
  await upsertItem(f.business, f.item, f.owner, {
    ...current,
    gstRateBps: 500,
    expectedVersion: 2,
    operationId: randomUUID(),
  });
  const draft = await quotationDraft(f.business, quote.id);
  assert.equal(draft.placeOfSupply, "29");
  assert.equal(draft.lines[0].catalogueVersion, 3);
  assert.equal(draft.lines[0].catalogueChanged, true);
  const converted = await createBill(f.business, f.owner, "owner", {
    ...billInput(f),
    quotationId: quote.id,
    placeOfSupply: draft.placeOfSupply,
    lines: draft.lines.map((l) => ({
      id: randomUUID(),
      itemId: l.itemId,
      unitId: l.unitId,
      catalogueVersion: l.catalogueVersion,
      quantityMilli: l.quantityMilli,
      overridePriceMinor: l.overridePriceMinor,
    })),
  });
  assert.equal(converted.tax.lines[0].gstRateBps, 500);
  assert.equal(
    (await getQuotation(f.business, quote.id)).quotation.document_snapshot.tax
      .lines[0].gstRateBps,
    1800,
  );
});
test("admin creates explicit modes and business membership lists expose mode", async () => {
  await assert.rejects(
    () => createBusiness({ id: randomUUID(), name: "No mode" }),
    /Choose composition/,
  );
  const business = await createBusiness({
    id: randomUUID(),
    name: "GST Shop",
    documentMode: "composition",
  });
  assert.equal(business.documentMode, "composition");
  const f = await gstFixture();
  assert.equal(
    (await businessesForUser(f.owner))[0].documentMode,
    "regular_gst",
  );
});
test.after(() => pool.end());
