import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../src/config.js";
import { saleFixture } from "./helpers/fixtures.js";
import { upsertItem, pullChanges } from "../src/services/catalogue.js";
import { createBill, getBill } from "../src/services/billing.js";
import { itemInput } from "../src/utils/validation.js";

if (
  process.env.APP_ENV !== "development" ||
  !new URL(process.env.DATABASE_URL).pathname.includes("_tdd_")
)
  throw new Error("Isolated development database required");
test("price sync supplies changed rows while historical offline bills keep their validated price and owner stale flag", async () => {
  try {
    const f = await saleFixture();
    for (const factor of ["0", "999999999999"])
      assert.equal(
        itemInput.safeParse({
          id: f.item,
          name: "Item",
          canonicalUnit: "piece",
          units: [{ id: f.box, label: "box", factor, priceMinor: 1000 }],
          operationId: randomUUID(),
        }).success,
        false,
      );
    await upsertItem(f.business, f.item, f.owner, {
      id: f.item,
      name: "Item",
      canonicalUnit: "piece",
      active: true,
      expectedVersion: 1,
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
    const sync = await pullChanges(f.business, 0, f.staff, "staff");
    const item = sync.changes.find((x) => x.kind === "catalogue.item").data;
    assert.equal(item.units.find((x) => x.id === f.box).priceMinor, "1200");
    const id = randomUUID();
    const result = await createBill(f.business, f.staff, "staff", {
      id,
      customerId: f.customer,
      occurrenceAt: new Date().toISOString(),
      operationId: randomUUID(),
      lines: [
        {
          id: randomUUID(),
          itemId: f.item,
          unitId: f.box,
          catalogueVersion: 1,
          quantityMilli: 1000,
        },
      ],
      payments: [{ id: randomUUID(), method: "cash", amountMinor: 1000 }],
    });
    assert.equal(result.totalMinor, "1000");
    assert.equal(result.reviewState, "not_required");
    const read = await getBill(f.business, id, f.owner, "owner");
    assert.equal(read.lines[0].stale_price, true);
    assert.equal(read.lines[0].current_price_minor_at_issue, "1200");
    assert.equal(read.lines[0].unit_price_minor, "1000");
  } finally {
    await pool.end();
  }
});
