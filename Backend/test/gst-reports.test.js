import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { pool } from "../src/config.js";
import app from "../src/app.js";
import { issueToken } from "../src/auth.js";
import { saleFixture } from "./helpers/fixtures.js";
import { upsertItem, listCatalogue } from "../src/services/catalogue.js";
import { createBill } from "../src/services/billing.js";
import { recordDelivery } from "../src/services/delivery.js";
import { recordReturn } from "../src/services/returns.js";
import { cancelBill } from "../src/services/cancellation.js";
import { gstSummary } from "../src/services/gst-reports.js";
if (
  process.env.APP_ENV !== "development" ||
  !new URL(process.env.DATABASE_URL).pathname.includes("_tdd_")
)
  throw new Error("Isolated development database required");
const wide = ["2000-01-01T00:00:00+05:30", "2100-01-01T00:00:00+05:30"];

test("GST report uses saved intra/inter/composition amounts and separately dates operational returns/cancellations", async () => {
  const f = await saleFixture();
  const profile = {
    name: "Supplier",
    address: "Mumbai",
    phone: "1234567890",
    signatory: "Owner",
    gstin: "27AAPFU0939F1ZV",
    stateCode: "27",
  };
  await pool.query(
    "UPDATE businesses SET document_mode=$2,document_profile=$3 WHERE id=$1",
    [f.business, "regular_gst", profile],
  );
  const current = (await listCatalogue(f.business))[0];
  await upsertItem(f.business, f.item, f.owner, {
    ...current,
    hsn: "1001",
    gstRateBps: 1800,
    taxCategory: "taxable",
    units: current.units.map((u) => ({ ...u, priceMinor: 11800 })),
    expectedVersion: 1,
    operationId: randomUUID(),
  });
  const makeBill = async (pos) => {
    const input = {
      id: randomUUID(),
      customerId: f.customer,
      placeOfSupply: pos,
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
    };
    await createBill(f.business, f.owner, "owner", input);
    await pool.query(
      "UPDATE bills SET issued_at='2020-06-01T12:00:00+05:30' WHERE business_id=$1 AND id=$2",
      [f.business, input.id],
    );
    return input;
  };
  const intra = await makeBill("27"),
    inter = await makeBill("29");
  await pool.query(
    "UPDATE businesses SET document_mode='composition' WHERE id=$1",
    [f.business],
  );
  const composition = await makeBill("27");
  await pool.query("UPDATE businesses SET document_profile=$2 WHERE id=$1", [
    f.business,
    { ...profile, name: "Changed legal profile" },
  ]);
  await pool.query("UPDATE items SET gst_rate_bps=500 WHERE business_id=$1", [
    f.business,
  ]);
  await pool.query(
    "UPDATE item_units SET price_minor=999999 WHERE business_id=$1",
    [f.business],
  );
  await recordDelivery(f.business, f.owner, "owner", {
    id: randomUUID(),
    billId: intra.id,
    lineId: intra.lines[0].id,
    unitId: f.box,
    quantityMilli: 1000,
    occurrenceAt: new Date().toISOString(),
    operationId: randomUUID(),
  });
  await recordReturn(f.business, f.owner, {
    id: randomUUID(),
    billId: intra.id,
    lineId: intra.lines[0].id,
    unitId: f.box,
    quantityMilli: 500,
    disposition: "restockable",
    reason: "Half returned",
    operationId: randomUUID(),
  });
  await cancelBill(f.business, f.owner, {
    billId: inter.id,
    reason: "Full cancellation",
    operationId: randomUUID(),
  });
  const report = await gstSummary(f.business, ...wide);
  assert.equal(report.statutory, false);
  assert.equal(report.adjustmentsLegalStatus, "unissued");
  assert.deepEqual(report.totals.original, {
    baseMinor: "31800",
    cgstMinor: "900",
    sgstMinor: "900",
    igstMinor: "1800",
    grossMinor: "35400",
  });
  assert.deepEqual(report.totals.reversed, {
    baseMinor: "15000",
    cgstMinor: "450",
    sgstMinor: "450",
    igstMinor: "1800",
    grossMinor: "17700",
  });
  assert.deepEqual(report.totals.net, {
    baseMinor: "16800",
    cgstMinor: "450",
    sgstMinor: "450",
    igstMinor: "0",
    grossMinor: "17700",
  });
  assert.equal(report.legacy.billCount, 1);
  assert.equal(report.legacy.grossMinor, "2000");
  const comp = report.modes.find((m) => m.mode === "composition");
  assert.equal(comp.original.grossMinor, "11800");
  assert.equal(comp.original.cgstMinor, "0");
  const interstate = report.modes.find((m) => m.taxType === "inter");
  assert.equal(interstate.originalDocumentCount, 1);
  assert.equal(interstate.reversalEntryCount, 1);
  assert.equal(interstate.net.grossMinor, "0");
  const salePeriod = await gstSummary(
    f.business,
    "2020-06-01T00:00:00+05:30",
    "2020-06-02T00:00:00+05:30",
  );
  assert.equal(salePeriod.totals.original.grossMinor, "35400");
  assert.equal(salePeriod.totals.reversed.grossMinor, "0");
  const returnPeriod = await gstSummary(
    f.business,
    "2021-01-01T00:00:00+05:30",
    wide[1],
  );
  assert.equal(returnPeriod.totals.original.grossMinor, "0");
  assert.equal(returnPeriod.totals.reversed.grossMinor, "17700");
  assert.equal(returnPeriod.totals.net.grossMinor, "-17700");
  assert.equal(
    (
      await pool.query(
        "SELECT lifecycle FROM bills WHERE business_id=$1 AND id=$2",
        [f.business, inter.id],
      )
    ).rows[0].lifecycle,
    "cancelled",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT document_snapshot->'tax'->>'totalMinor' gross FROM bills WHERE business_id=$1 AND id=$2",
        [f.business, composition.id],
      )
    ).rows[0].gross,
    "11800",
  );
  // Existing authentication middleware keeps financial reports scoped to owners.
  const sessions = {};
  for (const role of ["owner", "staff"]) {
    const device = randomUUID(),
      session = randomUUID();
    await pool.query(
      "INSERT INTO devices(id,user_id,name) VALUES ($1,$2,'Test')",
      [device, f[role]],
    );
    await pool.query(
      "INSERT INTO refresh_sessions(id,device_id,user_id,token_hash,expires_at) VALUES ($1,$2,$3,$4,now()+interval '1 day')",
      [session, device, f[role], randomUUID()],
    );
    sessions[role] = await issueToken({ id: f[role] }, session);
  }
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const url = `http://127.0.0.1:${server.address().port}/v1/businesses/${f.business}/reports/gst`;
    const query = new URLSearchParams({ from: wide[0], to: wide[1] });
    assert.equal(
      (
        await fetch(`${url}?${query}`, {
          headers: { Authorization: `Bearer ${sessions.staff}` },
        })
      ).status,
      403,
    );
    const response = await fetch(`${url}?${query}`, {
      headers: { Authorization: `Bearer ${sessions.owner}` },
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).totals, report.totals);
    assert.equal(
      (
        await fetch(
          `${url}?${new URLSearchParams({ from: wide[1], to: wide[0] })}`,
          { headers: { Authorization: `Bearer ${sessions.owner}` } },
        )
      ).status,
      400,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test.after(() => pool.end());
