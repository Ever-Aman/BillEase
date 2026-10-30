import test from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { pool } from "../src/config.js";
import { saleFixture } from "./helpers/fixtures.js";
import { writeBillPdf } from "../src/services/documents.js";

if (
  process.env.APP_ENV !== "development" ||
  !new URL(process.env.DATABASE_URL).pathname.includes("_tdd_")
)
  throw new Error("Isolated development database required");
async function pdf(f, options) {
  const res = new PassThrough();
  res.setHeader = () => {};
  const chunks = [];
  res.on("data", (x) => chunks.push(x));
  const complete = once(res, "end");
  await writeBillPdf(f.business, f.bill, f.owner, res, options);
  await complete;
  const buffer = Buffer.concat(chunks);
  const result = spawnSync("pdftotext", ["-", "-"], { input: buffer });
  assert.equal(result.status, 0);
  return { buffer, text: result.stdout.toString() };
}
test("owner PDF options use issuance balance snapshot and do not write ledger entries", async () => {
  try {
    const f = await saleFixture({ cash: 500, priorDebt: 1000 });
    const before = (
      await pool.query(
        "SELECT COUNT(*)::integer count FROM customer_ledger WHERE business_id=$1",
        [f.business],
      )
    ).rows[0].count;
    const plain = await pdf(f, {});
    assert.doesNotMatch(plain.text, /Previous debt at issuance/);
    const detailed = await pdf(f, { showPayments: true, showPriorDebt: true });
    assert.match(detailed.text, /Billed by/);
    assert.equal(
      (
        await pool.query(
          "SELECT document_snapshot->>'layoutRevision' revision FROM bills WHERE business_id=$1 AND id=$2",
          [f.business, f.bill],
        )
      ).rows[0].revision,
      "reference-invoice-v1",
    );
    assert.match(detailed.text, /Previous debt at issuance: INR 10\.00/);
    assert.match(detailed.text, /cash.*INR 5\.00/i);
    assert.match(detailed.text, /Current overall customer debt: INR 25\.00/);
    assert.equal(
      (
        await pool.query(
          "SELECT COUNT(*)::integer count FROM customer_ledger WHERE business_id=$1",
          [f.business],
        )
      ).rows[0].count,
      before,
    );
    await pool.query(
      "UPDATE bills SET document_snapshot=jsonb_set(document_snapshot,'{layoutRevision}',to_jsonb($3::text)) WHERE business_id=$1 AND id=$2",
      [f.business, f.bill, "non-gst-v1"],
    );
    await pool.query("UPDATE businesses SET document_profile=$2 WHERE id=$1", [
      f.business,
      {
        name: "Changed supplier",
        address: "Changed address",
        phone: "9999999999",
      },
    ]);
    await pool.query(
      "UPDATE customers SET name='Changed customer',locality='Changed locality',phone='9999999999' WHERE business_id=$1 AND id=$2",
      [f.business, f.customer],
    );
    await pool.query(
      "UPDATE items SET name='Changed item' WHERE business_id=$1 AND id=$2",
      [f.business, f.item],
    );
    const legacy = await pdf(f, {});
    assert.doesNotMatch(legacy.text, /Billed by/);
    assert.match(legacy.text, /Supplier/);
    assert.match(legacy.text, /Test address/);
    assert.match(legacy.text, /Customer, Test \| 1234567890/);
    assert.match(legacy.text, /Item \/ box/);
    assert.doesNotMatch(
      legacy.text,
      /Changed supplier|Changed address|Changed customer|Changed item/,
    );
    await pool.query(
      "UPDATE bills SET document_snapshot=jsonb_set(document_snapshot,'{layoutRevision}',to_jsonb($3::text)) WHERE business_id=$1 AND id=$2",
      [f.business, f.bill, "future-unknown-layout"],
    );
    let headerCalls = 0;
    const rejectedRes = new PassThrough();
    rejectedRes.setHeader = () => headerCalls++;
    await assert.rejects(
      writeBillPdf(f.business, f.bill, f.owner, rejectedRes),
      { status: 409 },
    );
    assert.equal(headerCalls, 0);
    if (process.env.PDF_SAMPLE_DIR) {
      await mkdir(process.env.PDF_SAMPLE_DIR, { recursive: true });
      await writeFile(
        `${process.env.PDF_SAMPLE_DIR}/owner-bill.pdf`,
        detailed.buffer,
      );
    }
  } finally {
    await pool.end();
  }
});
