import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync, sign } from "node:crypto";
import { pool } from "../src/config.js";
import { saleFixture } from "./helpers/fixtures.js";
import { canonical } from "../src/utils/validation.js";
import {
  uploadRevokedWork,
  decideQuarantine,
} from "../src/services/quarantine.js";
import { recordDelivery } from "../src/services/delivery.js";

if (
  process.env.APP_ENV !== "development" ||
  !new URL(process.env.DATABASE_URL).pathname.includes("_tdd_")
)
  throw new Error("Isolated development database required");
test("owner can accept signed quarantined owner repayment and return without changing original actor", async () => {
  try {
    const f = await saleFixture();
    const deviceId = randomUUID(),
      keys = generateKeyPairSync("ed25519");
    await pool.query(
      "INSERT INTO devices(id,user_id,name,active,public_key) VALUES ($1,$2,'Revoked phone',false,$3)",
      [
        deviceId,
        f.owner,
        keys.publicKey
          .export({ type: "spki", format: "der" })
          .toString("base64"),
      ],
    );
    const upload = async (payloadType, payload) => {
      const message = {
        deviceId,
        businessId: f.business,
        operationId: payload.operationId,
        payloadType,
        payload,
      };
      const signature = sign(
        null,
        Buffer.from(canonical(message)),
        keys.privateKey,
      ).toString("base64url");
      await uploadRevokedWork({ ...message, signature });
      return decideQuarantine(
        f.business,
        deviceId,
        payload.operationId,
        f.owner,
        {
          accept: true,
          reason: "Verified old work",
          decisionOperationId: randomUUID(),
        },
      );
    };
    const payment = await upload("payment", {
      customerId: f.customer,
      amountMinor: 500,
      note: "Cash repayment",
      operationId: randomUUID(),
    });
    assert.equal(payment.actionResult.debtPaidMinor, "500");
    await recordDelivery(f.business, f.owner, "owner", {
      id: randomUUID(),
      billId: f.bill,
      lineId: f.line,
      unitId: f.piece,
      quantityMilli: 1000,
      occurrenceAt: new Date().toISOString(),
      operationId: randomUUID(),
    });
    const returned = await upload("return", {
      id: randomUUID(),
      billId: f.bill,
      lineId: f.line,
      unitId: f.piece,
      quantityMilli: 1000,
      disposition: "restockable",
      resolution: "advance",
      reason: "Old owner return",
      operationId: randomUUID(),
    });
    assert.equal(returned.actionResult.valueMinor, "100");
    const balance = (
      await pool.query(
        "SELECT SUM(debt_delta_minor)::text debt FROM customer_ledger WHERE business_id=$1",
        [f.business],
      )
    ).rows[0];
    assert.equal(balance.debt, "1400");
    assert.equal(
      (
        await pool.query("SELECT actor_id FROM returns WHERE business_id=$1", [
          f.business,
        ])
      ).rows[0].actor_id,
      f.owner,
    );
  } finally {
    await pool.end();
  }
});
