import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../src/config.js";
import { saleFixture } from "./helpers/fixtures.js";
import { recordDelivery, deliveryView } from "../src/services/delivery.js";
import { decideCredit } from "../src/services/billing.js";

if (
  process.env.APP_ENV !== "development" ||
  !new URL(process.env.DATABASE_URL).pathname.includes("_tdd_")
)
  throw new Error("Isolated development database required");
test("confirmed partial money authorizes only covered original-priced quantities without exposing money", async () => {
  try {
    const f = await saleFixture({ cash: 500, digital: 1500, role: "staff" });
    const view = await deliveryView(f.business, f.bill);
    assert.ok(view.lines[0].item_id);
    assert.ok(view.lines[0].units.some((u) => u.id === f.piece));
    assert.equal(
      Number(view.authorization.lines[0].permittedAdditionalCanonical),
      5,
    );
    assert.equal(
      /price|amount|minor|balance/i.test(JSON.stringify(view)),
      false,
    );
    const event = {
      id: randomUUID(),
      billId: f.bill,
      lineId: f.line,
      unitId: f.piece,
      quantityMilli: 4000,
      occurrenceAt: new Date().toISOString(),
      operationId: randomUUID(),
      authorizationRevision: view.authorization.revision,
    };
    await recordDelivery(f.business, f.staff, "staff", event);
    const after = await deliveryView(f.business, f.bill);
    assert.equal(
      Number(after.authorization.lines[0].permittedAdditionalCanonical),
      1,
    );
    await assert.rejects(
      recordDelivery(f.business, f.staff, "staff", {
        ...event,
        id: randomUUID(),
        operationId: randomUUID(),
        quantityMilli: 2000,
        authorizationRevision: undefined,
      }),
      /coverage|confirmed/i,
    );
    const conflict = await recordDelivery(f.business, f.staff, "staff", {
      ...event,
      id: randomUUID(),
      operationId: randomUUID(),
      quantityMilli: 4000,
    });
    assert.equal(conflict.coverageConflict, true);
    assert.equal(conflict.state, "disputed");
    await decideCredit(f.business, f.owner, {
      billId: f.bill,
      approve: true,
      operationId: randomUUID(),
    });
    const approved = await deliveryView(f.business, f.bill);
    assert.equal(approved.authorization.ownerCreditRelease, true);
    assert.equal(
      Number(approved.authorization.lines[0].permittedAdditionalCanonical),
      12,
    );
  } finally {
    await pool.end();
  }
});
