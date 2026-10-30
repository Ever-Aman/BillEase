import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import { pool } from "../src/config.js";
import { saleFixture } from "./helpers/fixtures.js";
import { writeCompositionPreview } from "../src/services/composition-preview.js";

if (
  process.env.APP_ENV !== "development" ||
  !new URL(process.env.DATABASE_URL).pathname.includes("_tdd_")
)
  throw new Error("Isolated development database required");

test("composition preview uses the selected party-panel layout without issuing a bill or charging GST", async () => {
  try {
    const f = await saleFixture();
    await pool.query("UPDATE businesses SET document_profile=$2 WHERE id=$1", [
      f.business,
      {
        name: "Test Supplier",
        address: "Test supplier address",
        phone: "9000000000",
        gstin: "29ABCDE1234F1Z5",
        signatory: "Test Owner",
      },
    ]);
    const count = async () =>
      (
        await pool.query(
          "SELECT (SELECT count(*) FROM bills WHERE business_id=$1)::int bills, (SELECT count(*) FROM customer_ledger WHERE business_id=$1)::int ledger",
          [f.business],
        )
      ).rows[0];
    const before = await count();
    const res = new PassThrough();
    res.setHeader = () => {};
    const chunks = [];
    res.on("data", (chunk) => chunks.push(chunk));
    const done = once(res, "end");
    await writeCompositionPreview(
      f.business,
      {
        recipientName: "Preview Recipient",
        recipientAddress: "Recipient test address",
        lines: [
          {
            hsn: "3926",
            description: "Sample item",
            quantity: "2",
            valueMinor: 140400,
          },
        ],
      },
      res,
    );
    await done;
    const result = spawnSync("pdftotext", ["-", "-"], {
      input: Buffer.concat(chunks),
    });
    assert.equal(result.status, 0);
    const text = result.stdout.toString();
    assert.match(text, /Billed by/i);
    assert.match(text, /Billed to/i);
    assert.match(text, /HSN/);
    assert.match(text, /Preview Recipient/);
    assert.match(text, /DRAFT/);
    assert.match(text, /not eligible to collect tax/i);
    assert.doesNotMatch(text, /ACCOUNTANT REVIEW|CGST|SGST|IGST/);
    assert.deepEqual(await count(), before);
  } finally {
    await pool.end();
  }
});
