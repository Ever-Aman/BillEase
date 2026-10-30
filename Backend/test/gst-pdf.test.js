import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import { pool } from "../src/config.js";
import { saleFixture } from "./helpers/fixtures.js";
import { upsertItem, listCatalogue } from "../src/services/catalogue.js";
import { createBill } from "../src/services/billing.js";
import { createQuotation } from "../src/services/quotations.js";
import { validGstin } from "../src/services/gst.js";
import { writeBillPdf } from "../src/services/documents.js";
import { writeQuotationPdf } from "../src/services/quotation-documents.js";

if (
  process.env.APP_ENV !== "development" ||
  !new URL(process.env.DATABASE_URL).pathname.includes("_tdd_")
)
  throw new Error("Isolated development database required");

async function pdf(write) {
  const res = new PassThrough();
  res.setHeader = () => {};
  const chunks = [];
  res.on("data", (chunk) => chunks.push(chunk));
  const done = once(res, "end");
  await write(res);
  await done;
  const result = spawnSync("pdftotext", ["-layout", "-", "-"], {
    input: Buffer.concat(chunks),
  });
  assert.equal(result.status, 0);
  return result.stdout.toString();
}

test("issued GST bills and quotations render frozen tax snapshots through the selected PDF template", async () => {
  try {
    const gstin = [..."0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"]
      .map((c) => `27AAAAA0000A1Z${c}`)
      .find(validGstin);
    for (const mode of ["regular_gst", "composition"]) {
      const f = await saleFixture();
      await pool.query(
        "UPDATE businesses SET document_mode=$2,document_profile=$3 WHERE id=$1",
        [
          f.business,
          mode,
          {
            name: "SAMPLE SUPPLIER",
            address: "Sample Maharashtra address",
            phone: "9000000000",
            gstin,
            stateCode: "27",
            signatory: "Sample Owner",
          },
        ],
      );
      const item = (await listCatalogue(f.business))[0];
      await upsertItem(f.business, f.item, f.owner, {
        ...item,
        hsn: "3926",
        gstRateBps: 1800,
        taxCategory: "taxable",
        expectedVersion: item.version,
        units: item.units.map((u) => ({ ...u, priceMinor: 11800 })),
        operationId: randomUUID(),
      });
      const id = randomUUID(),
        lineId = randomUUID();
      await createBill(f.business, f.owner, "owner", {
        id,
        customerId: f.customer,
        placeOfSupply: "27",
        occurrenceAt: new Date().toISOString(),
        operationId: randomUUID(),
        payments: [],
        lines: [
          {
            id: lineId,
            itemId: f.item,
            unitId: f.box,
            catalogueVersion: 2,
            quantityMilli: 1000,
          },
        ],
      });
      const quoteId = randomUUID();
      await createQuotation(f.business, f.owner, {
        id: quoteId,
        customerId: f.customer,
        placeOfSupply: "27",
        reference: "SAMPLE-QUOTE",
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
      });
      await pool.query(
        "UPDATE businesses SET document_profile=$2 WHERE id=$1",
        [f.business, { name: "CHANGED LIVE NAME" }],
      );
      const before = (
        await pool.query(
          "SELECT count(*)::int count FROM customer_ledger WHERE business_id=$1",
          [f.business],
        )
      ).rows[0].count;
      const text = await pdf((res) =>
        writeBillPdf(f.business, id, f.owner, res),
      );
      assert.match(text, /Billed by/);
      assert.match(text, /SAMPLE SUPPLIER/);
      assert.doesNotMatch(text, /CHANGED LIVE NAME/);
      assert.match(text, /3926/);
      assert.match(text, /118\.00/);
      if (mode === "regular_gst") {
        assert.match(text, /TAX INVOICE/);
        assert.match(text, /CGST\s*%/);
        assert.match(text, /SGST\s*%/);
        assert.match(text, /100\.00/);
        assert.match(text, /9\.00/);
      } else {
        assert.match(text, /BILL OF SUPPLY/);
        assert.match(text, /not eligible to collect tax/);
        assert.doesNotMatch(text, /CGST|SGST/);
      }
      const quote = await pdf((res) =>
        writeQuotationPdf(f.business, quoteId, res),
      );
      assert.match(quote, /QUOTATION/);
      assert.match(quote, /SAMPLE-QUOTE/);
      assert.match(quote, /118\.00/);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int count FROM customer_ledger WHERE business_id=$1",
            [f.business],
          )
        ).rows[0].count,
        before,
      );
    }
  } finally {
    await pool.end();
  }
});
