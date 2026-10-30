import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import { pool } from "../src/config.js";
import { saleFixture } from "./helpers/fixtures.js";
import { recordDelivery } from "../src/services/delivery.js";
import { recordReturn } from "../src/services/returns.js";
import { cancelBill } from "../src/services/cancellation.js";
import { writeBillAdjustmentsPdf } from "../src/services/documents.js";
import { adjustmentTaxSnapshot } from "../src/utils/adjustment-tax.js";

if (
  process.env.APP_ENV !== "development" ||
  !new URL(process.env.DATABASE_URL).pathname.includes("_tdd_")
)
  throw new Error("Isolated development database required");

function savedLine({
  gross = "5",
  taxable = "3",
  cgst = "1",
  sgst = "1",
  igst = "0",
  mode = "regular_gst",
} = {}) {
  return {
    id: "line",
    bill_id: "bill",
    invoice_number: 1,
    financial_year: "2026-27",
    line_total_minor: gross,
    adjusted_value_minor: "0",
    document_snapshot: {
      tax: {
        mode,
        taxType:
          igst !== "0" ? "inter" : mode === "composition" ? "none" : "intra",
        stateCode: "29",
        placeOfSupply: "29",
        lines: [
          {
            lineId: "line",
            hsn: "1001",
            taxCategory: "taxable",
            gstRateBps: 10000,
            cgstRateBps: 5000,
            sgstRateBps: 5000,
            igstRateBps: 0,
            amountMinor: gross,
            taxableMinor: taxable,
            cgstMinor: cgst,
            sgstMinor: sgst,
            igstMinor: igst,
          },
        ],
      },
    },
  };
}

test("cumulative reversals conserve every component, including huge integers, one-paisa and zero-value steps", () => {
  for (const original of [
    savedLine(),
    savedLine({ gross: "3", taxable: "2", cgst: "0", sgst: "0", igst: "1" }),
    savedLine({
      gross: "5",
      taxable: "5",
      cgst: "0",
      sgst: "0",
      mode: "composition",
    }),
    savedLine({
      gross: "90071992547409931",
      taxable: "80071992547409931",
      cgst: "5000000000000000",
      sgst: "5000000000000000",
    }),
  ]) {
    const previous = [];
    const total = BigInt(original.line_total_minor);
    const steps =
      total > 100n
        ? [0n, 1n, 50000000000000000n, total - 50000000000000001n]
        : [0n, ...Array(Number(total)).fill(1n)];
    let adjusted = 0n;
    for (const value of steps) {
      const snapshot = adjustmentTaxSnapshot({
        line: { ...original, adjusted_value_minor: String(adjusted) },
        value,
        previous,
      });
      assert.equal(
        ["taxableMinor", "cgstMinor", "sgstMinor", "igstMinor"].reduce(
          (sum, key) => sum + BigInt(snapshot[key]),
          0n,
        ),
        value,
      );
      assert.equal(snapshot.legalStatus, "unissued");
      previous.push({ tax_snapshot: snapshot });
      adjusted += value;
    }
    for (const key of ["taxableMinor", "cgstMinor", "sgstMinor", "igstMinor"])
      assert.equal(
        previous.reduce(
          (sum, entry) => sum + BigInt(entry.tax_snapshot[key]),
          0n,
        ),
        BigInt(original.document_snapshot.tax.lines[0][key]),
      );
    assert.throws(
      () =>
        adjustmentTaxSnapshot({
          line: { ...original, adjusted_value_minor: String(total) },
          value: 1n,
          previous,
        }),
      /inconsistent/,
    );
  }
  assert.equal(
    adjustmentTaxSnapshot({ line: { document_snapshot: {} }, value: 1n }),
    null,
  );
});

test("interleaved returns and cancellations append immutable original-tax reversals and preserve settlement", async () => {
  try {
    const f = await saleFixture({ quantityMilli: 5000 });
    const template = savedLine();
    const tax = template.document_snapshot.tax;
    tax.lines[0].lineId = f.line;
    // Legacy fixture deliberately receives a saved issued tax snapshot. Valuation
    // remains the issued gross; live catalogue changes must not affect reversal.
    await pool.query(
      "UPDATE bill_lines SET line_total_minor=5 WHERE business_id=$1 AND id=$2",
      [f.business, f.line],
    );
    await pool.query(
      "UPDATE bills SET total_minor=5,document_snapshot=document_snapshot||$3::jsonb WHERE business_id=$1 AND id=$2",
      [f.business, f.bill, { tax }],
    );
    await pool.query(
      "UPDATE customer_ledger SET debt_delta_minor=3 WHERE business_id=$1 AND bill_id=$2",
      [f.business, f.bill],
    );
    await pool.query(
      "UPDATE item_units SET price_minor=999999 WHERE business_id=$1",
      [f.business],
    );
    const before = (
      await pool.query(
        "SELECT document_snapshot,invoice_number FROM bills WHERE business_id=$1 AND id=$2",
        [f.business, f.bill],
      )
    ).rows[0];
    await recordDelivery(f.business, f.owner, "owner", {
      id: randomUUID(),
      billId: f.bill,
      lineId: f.line,
      unitId: f.piece,
      quantityMilli: 30000,
      occurrenceAt: new Date().toISOString(),
      operationId: randomUUID(),
    });
    const returned = (quantityMilli) => ({
      id: randomUUID(),
      billId: f.bill,
      lineId: f.line,
      unitId: f.piece,
      quantityMilli,
      disposition: "restockable",
      resolution: "advance",
      reason: "Return issued goods",
      operationId: randomUUID(),
    });
    const cancelled = (quantityMilli) => ({
      billId: f.bill,
      lines: [{ lineId: f.line, unitId: f.piece, quantityMilli }],
      resolution: "refund",
      refundId: randomUUID(),
      refundMethod: "cash",
      reason: "Cancel undelivered goods",
      operationId: randomUUID(),
    });
    const first = returned(10000);
    const a = await recordReturn(f.business, f.owner, first);
    assert.deepEqual(await recordReturn(f.business, f.owner, first), a);
    const b = await cancelBill(f.business, f.owner, cancelled(10000));
    const c = await recordReturn(f.business, f.owner, returned(20000));
    const d = await cancelBill(f.business, f.owner, cancelled(10000));
    assert.deepEqual(
      [a.valueMinor, b.valueMinor, c.valueMinor, d.valueMinor],
      ["1", "1", "2", "1"],
    );
    assert.equal(c.debtReducedMinor, "1");
    assert.equal(c.excessMinor, "1");
    assert.equal(c.resolution, "advance");
    assert.equal(d.resolution, "refund");
    const rows = (
      await pool.query(
        "SELECT tax_snapshot FROM returns WHERE business_id=$1 UNION ALL SELECT tax_snapshot FROM line_cancellations WHERE business_id=$1",
        [f.business],
      )
    ).rows;
    for (const [key, expected] of [
      ["taxableMinor", 3n],
      ["cgstMinor", 1n],
      ["sgstMinor", 1n],
      ["igstMinor", 0n],
      ["totalMinor", 5n],
    ])
      assert.equal(
        rows.reduce((sum, row) => sum + BigInt(row.tax_snapshot[key]), 0n),
        expected,
      );
    assert.equal(rows.length, 4);
    for (const row of rows) {
      assert.equal(row.tax_snapshot.originalBillId, f.bill);
      assert.equal(row.tax_snapshot.originalLineId, f.line);
      assert.equal(row.tax_snapshot.legalStatus, "unissued");
      assert.equal(row.tax_snapshot.gstRateBps, 10000);
    }
    await assert.rejects(
      pool.query("UPDATE returns SET tax_snapshot='{}' WHERE business_id=$1", [
        f.business,
      ]),
      /immutable/,
    );
    await assert.rejects(
      pool.query(
        "UPDATE line_cancellations SET tax_snapshot='{}' WHERE business_id=$1",
        [f.business],
      ),
      /immutable/,
    );
    await assert.rejects(
      pool.query("DELETE FROM returns WHERE business_id=$1", [f.business]),
      /immutable/,
    );
    await assert.rejects(
      pool.query(
        "UPDATE line_cancellations SET value_minor=0 WHERE business_id=$1",
        [f.business],
      ),
      /immutable/,
    );
    assert.deepEqual(
      (
        await pool.query(
          "SELECT document_snapshot,invoice_number FROM bills WHERE business_id=$1 AND id=$2",
          [f.business, f.bill],
        )
      ).rows[0],
      before,
    );
    await assert.rejects(
      recordReturn(f.business, f.owner, returned(1000)),
      /quantity/,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT amount_minor::text FROM refunds WHERE business_id=$1",
          [f.business],
        )
      ).rows[0].amount_minor,
      "1",
    );
    const ledgerBefore = (
      await pool.query(
        "SELECT COUNT(*)::integer count FROM customer_ledger WHERE business_id=$1",
        [f.business],
      )
    ).rows[0].count;
    const response = new PassThrough();
    response.setHeader = () => {};
    const chunks = [];
    response.on("data", (chunk) => chunks.push(chunk));
    const complete = once(response, "end");
    await writeBillAdjustmentsPdf(f.business, f.bill, f.owner, response);
    await complete;
    const extracted = spawnSync("pdftotext", ["-", "-"], {
      input: Buffer.concat(chunks),
    });
    assert.equal(extracted.status, 0, extracted.stderr.toString());
    const text = extracted.stdout.toString().replace(/\s+/g, " ");
    assert.match(text, /BILL ADJUSTMENT HISTORY/);
    assert.match(text, /Original amount: INR 0\.05/);
    const reference = `${a.taxSnapshot.originalFinancialYear}/${a.taxSnapshot.originalInvoiceNumber}`;
    assert.ok(text.includes(`Original bill: ${reference}`));
    assert.equal(text.match(/Tax reversal \| Original /g)?.length, 4);
    assert.equal(
      text.split(`Tax reversal | Original ${reference}`).length - 1,
      4,
    );
    assert.match(text, /Taxable INR 0\.01/);
    assert.match(text, /CGST INR 0\.01/);
    assert.match(text, /SGST INR 0\.01/);
    assert.match(text, /IGST INR 0\.00/);
    assert.match(text, /not a GST credit note or tax invoice/);
    assert.equal(
      (
        await pool.query(
          "SELECT COUNT(*)::integer count FROM customer_ledger WHERE business_id=$1",
          [f.business],
        )
      ).rows[0].count,
      ledgerBefore,
    );
  } finally {
    await pool.end();
  }
});
