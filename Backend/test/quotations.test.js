import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import { pool } from "../src/config.js";
import { saleFixture } from "./helpers/fixtures.js";
import { createQuotation, quotationDraft } from "../src/services/quotations.js";
import { upsertItem } from "../src/services/catalogue.js";
import { writeQuotationPdf } from "../src/services/quotation-documents.js";

if (
  process.env.APP_ENV !== "development" ||
  !new URL(process.env.DATABASE_URL).pathname.includes("_tdd_")
)
  throw new Error("Isolated development database required");
test("quotation PDF preserves quoted values and copying flags current catalogue price changes without debt", async () => {
  try {
    const f = await saleFixture();
    const before = (
      await pool.query(
        "SELECT COUNT(*)::integer count FROM customer_ledger WHERE business_id=$1",
        [f.business],
      )
    ).rows[0].count;
    const id = randomUUID();
    await createQuotation(f.business, f.owner, {
      id,
      reference: "QUOTE-001",
      customerId: f.customer,
      lines: [
        {
          id: randomUUID(),
          itemId: f.item,
          unitId: f.box,
          catalogueVersion: 1,
          quantityMilli: 1000,
        },
      ],
      operationId: randomUUID(),
    });
    assert.equal(
      (
        await pool.query(
          "SELECT document_snapshot->>'layoutRevision' revision FROM quotations WHERE business_id=$1 AND id=$2",
          [f.business, id],
        )
      ).rows[0].revision,
      "reference-quotation-v1",
    );
    await upsertItem(f.business, f.item, f.owner, {
      id: f.item,
      name: "Item",
      canonicalUnit: "piece",
      expectedVersion: 1,
      active: true,
      units: [
        {
          id: f.box,
          label: "box",
          factor: "10",
          priceMinor: 1200,
          active: true,
        },
        {
          id: f.piece,
          label: "piece",
          factor: "1",
          priceMinor: 200,
          active: true,
        },
      ],
      operationId: randomUUID(),
    });
    const draft = await quotationDraft(f.business, id);
    assert.equal(draft.lines[0].overridePriceMinor, 1000);
    assert.equal(draft.lines[0].currentPriceMinor, "1200");
    assert.equal(draft.lines[0].priceChanged, true);
    const res = new PassThrough();
    res.setHeader = () => {};
    const chunks = [];
    res.on("data", (x) => chunks.push(x));
    const done = once(res, "end");
    await writeQuotationPdf(f.business, id, res);
    await done;
    const text = spawnSync("pdftotext", ["-", "-"], {
      input: Buffer.concat(chunks),
    }).stdout.toString();
    assert.match(text, /QUOTATION/);
    assert.match(text, /QUOTE-001/);
    assert.match(text, /INR 10\.00/);
    assert.match(text, /Billed by/);
    await pool.query(
      "UPDATE quotations SET document_snapshot=jsonb_set(document_snapshot,'{layoutRevision}',to_jsonb($3::text)) WHERE business_id=$1 AND id=$2",
      [f.business, id, "quotation-v1"],
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
    const legacyRes = new PassThrough();
    legacyRes.setHeader = () => {};
    const legacyChunks = [];
    legacyRes.on("data", (chunk) => legacyChunks.push(chunk));
    const legacyDone = once(legacyRes, "end");
    await writeQuotationPdf(f.business, id, legacyRes);
    await legacyDone;
    const legacyText = spawnSync("pdftotext", ["-", "-"], {
      input: Buffer.concat(legacyChunks),
    }).stdout.toString();
    assert.doesNotMatch(legacyText, /Billed by/);
    assert.match(legacyText, /Supplier/);
    assert.match(legacyText, /Test address/);
    assert.match(legacyText, /Customer, Test \| 1234567890/);
    assert.match(legacyText, /Item \/ box/);
    assert.doesNotMatch(
      legacyText,
      /Changed supplier|Changed address|Changed customer|Changed item/,
    );
    await pool.query(
      "UPDATE quotations SET document_snapshot=jsonb_set(document_snapshot,'{layoutRevision}',to_jsonb($3::text)) WHERE business_id=$1 AND id=$2",
      [f.business, id, "future-unknown-layout"],
    );
    let headerCalls = 0;
    const rejectedRes = new PassThrough();
    rejectedRes.setHeader = () => headerCalls++;
    await assert.rejects(writeQuotationPdf(f.business, id, rejectedRes), {
      status: 409,
    });
    assert.equal(headerCalls, 0);
    assert.equal(
      (
        await pool.query(
          "SELECT COUNT(*)::integer count FROM customer_ledger WHERE business_id=$1",
          [f.business],
        )
      ).rows[0].count,
      before,
    );
  } finally {
    await pool.end();
  }
});
