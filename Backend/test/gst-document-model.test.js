import test from "node:test";
import assert from "node:assert/strict";
import { gstDocumentModel } from "../src/utils/gst-document-model.js";

const tax = {
  mode: "regular_gst",
  documentType: "tax_invoice",
  taxType: "intra",
  placeOfSupply: "29",
  subtotalMinor: "10000",
  taxableMinor: "10000",
  cgstMinor: "900",
  sgstMinor: "900",
  igstMinor: "0",
  totalMinor: "11800",
  lines: [
    {
      lineId: "saved-line",
      hsn: "3926",
      taxableMinor: "10000",
      cgstRateBps: 900,
      sgstRateBps: 900,
      igstRateBps: 0,
      cgstMinor: "900",
      sgstMinor: "900",
      igstMinor: "0",
      amountMinor: "11800",
    },
  ],
};
const line = {
  id: "saved-line",
  description: "Saved item",
  hsn: "0000",
  amountMinor: "99999",
  quantity: "1",
};

test("GST PDF maps frozen HSN, separate component rates and values without recalculating money", () => {
  const saved = structuredClone(tax);
  const view = gstDocumentModel({ tax }, [line]);
  assert.equal(view.title, "TAX INVOICE");
  assert.equal(view.placeOfSupply, "Karnataka (29)");
  assert.equal(view.lines[0].hsn, "3926");
  assert.equal(view.lines[0].cgstRate, "9");
  assert.equal(view.lines[0].sgstRate, "9");
  assert.equal(view.lines[0].amountMinor, "11800");
  assert.deepEqual(tax, saved);
  assert.equal(
    gstDocumentModel({ tax }, [line], { quotation: true }).title,
    "QUOTATION",
  );
});

test("regular exempt bill of supply does not acquire a composition declaration", () => {
  const view = gstDocumentModel(
    { tax: { ...tax, documentType: "bill_of_supply" } },
    [line],
  );
  assert.equal(view.title, "BILL OF SUPPLY");
  assert.equal(view.mode, "bill_of_supply");
  const composition = gstDocumentModel(
    { tax: { ...tax, mode: "composition", documentType: "bill_of_supply" } },
    [line],
  );
  assert.equal(composition.mode, "composition");
});

test("interstate and mixed tax documents keep the original transaction type", () => {
  const inter = gstDocumentModel(
    { tax: { ...tax, taxType: "inter", placeOfSupply: "27" } },
    [line],
  );
  assert.equal(inter.taxType, "inter");
  assert.equal(inter.placeOfSupply, "Maharashtra (27)");
  const mixed = gstDocumentModel(
    { tax: { ...tax, documentType: "invoice_cum_bill_of_supply" } },
    [line],
  );
  assert.equal(mixed.title, "INVOICE-CUM-BILL OF SUPPLY");
});

test("missing original line tax fails rather than fabricating an invoice", () => {
  assert.throws(
    () => gstDocumentModel({ tax }, [{ ...line, id: "other-line" }]),
    (error) => error.status === 409,
  );
});
