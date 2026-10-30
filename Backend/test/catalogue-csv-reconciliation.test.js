import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import app from "../src/app.js";
import { pool } from "../src/config.js";
import { issueToken } from "../src/auth.js";
import { saleFixture } from "./helpers/fixtures.js";
import { upsertItem } from "../src/services/catalogue.js";
import {
  template,
  previewCatalogueCsv,
  importCatalogueCsv,
  catalogueImportStatus,
} from "../src/services/catalogue-csv.js";
if (
  process.env.APP_ENV !== "development" ||
  !new URL(process.env.DATABASE_URL).pathname.includes("_tdd_")
)
  throw new Error("Isolated development database required");

test("CSV status reconciles prior partial imports without writes and future imports are atomic", async () => {
  let server;
  try {
    const f = await saleFixture();
    const fresh = randomUUID(),
      unit = randomUUID(),
      acceptedOp = randomUUID(),
      conflictOp = randomUUID();
    const csv =
      template +
      `${fresh},Fresh,piece,${unit},piece,1,500,,${acceptedOp}\n${f.item},Changed,piece,${f.piece},piece,1,700,1,${conflictOp}\n`;
    const preview = previewCatalogueCsv(csv);
    assert.deepEqual(preview.errors, []);
    // Simulate an older importer that committed the first item before a conflict.
    await upsertItem(f.business, fresh, f.owner, preview.items[0]);
    await upsertItem(f.business, f.item, f.owner, {
      ...preview.items[1],
      expectedVersion: 1,
      operationId: randomUUID(),
    });
    const counts = async () =>
      (
        await pool.query(`SELECT
      (SELECT count(*) FROM operations) AS operations,
      (SELECT count(*) FROM catalogue_revisions) AS revisions,
      (SELECT count(*) FROM audit_events) AS audits,
      (SELECT count(*) FROM change_log) AS changes`)
      ).rows[0];
    const before = await counts();
    const result = await catalogueImportStatus(f.business, f.owner, csv);
    assert.deepEqual(
      result.items.map((x) => x.status),
      ["accepted", "version_conflict"],
    );
    assert.deepEqual(
      result.items.map((x) => x.currentVersion),
      [1, 2],
    );
    assert.deepEqual(
      result.items.map((x) => x.intent),
      preview.items,
    );
    assert.equal(result.items[0].acceptedResult.version, 1);
    assert.deepEqual(await counts(), before);
    await assert.rejects(importCatalogueCsv(f.business, f.owner, csv), {
      status: 409,
    });
    assert.deepEqual(await counts(), before);
    const exact = template + csv.slice(template.length).split("\n")[0] + "\n";
    assert.equal(
      (await importCatalogueCsv(f.business, f.owner, exact)).results[0].version,
      1,
    );
    assert.deepEqual(await counts(), before);
    const altered = exact.replace(",500,", ",501,");
    assert.equal(
      (await catalogueImportStatus(f.business, f.owner, altered)).items[0]
        .status,
      "operation_conflict",
    );
    assert.equal(
      (await catalogueImportStatus(f.business, f.staff, exact)).items[0].status,
      "operation_conflict",
    );
    await pool.query(
      "UPDATE operations SET operation_type='other' WHERE business_id=$1 AND operation_id=$2",
      [f.business, acceptedOp],
    );
    assert.equal(
      (await catalogueImportStatus(f.business, f.owner, exact)).items[0].status,
      "operation_conflict",
    );
    await assert.rejects(importCatalogueCsv(f.business, f.owner, exact), {
      status: 409,
    });
    const newCsv = csv
      .replaceAll(fresh, randomUUID())
      .replaceAll(unit, randomUUID())
      .replaceAll(acceptedOp, randomUUID());
    assert.equal(
      (await catalogueImportStatus(f.business, f.owner, newCsv)).items[0]
        .status,
      "not_applied",
    );
    const prior = await counts();
    await assert.rejects(importCatalogueCsv(f.business, f.owner, newCsv), {
      status: 409,
    });
    assert.deepEqual(await counts(), prior);
    assert.equal(
      (await catalogueImportStatus(f.business, f.owner, newCsv)).items[0]
        .currentVersion,
      null,
    );
    const device = randomUUID(),
      session = randomUUID();
    await pool.query(
      "INSERT INTO devices(id,user_id,name) VALUES ($1,$2,'CSV test')",
      [device, f.staff],
    );
    await pool.query(
      "INSERT INTO refresh_sessions(id,device_id,user_id,token_hash,expires_at) VALUES ($1,$2,$3,$4,now()+interval '1 day')",
      [session, device, f.staff, randomUUID()],
    );
    const token = await issueToken({ id: f.staff }, session);
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    for (const path of ["import-status", "import"]) {
      const response = await fetch(
        `http://127.0.0.1:${server.address().port}/v1/businesses/${f.business}/catalogue/${path}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "text/csv",
          },
          body: csv,
        },
      );
      assert.equal(response.status, 403);
    }
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
});
