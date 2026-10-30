import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync, sign } from "node:crypto";
import { once } from "node:events";
import { pool } from "../src/config.js";
import app from "../src/app.js";
import { issueToken } from "../src/auth.js";
import { saleFixture } from "./helpers/fixtures.js";
import { canonical } from "../src/utils/validation.js";
import {
  uploadRevokedWork,
  reconcileQuarantine,
  listQuarantine,
} from "../src/services/quarantine.js";

test("owner manually closes retained nonfinancial originals once without executing payload or changing money", async () => {
  let server;
  try {
    const f = await saleFixture(),
      deviceId = randomUUID(),
      keys = generateKeyPairSync("ed25519");
    await pool.query(
      "INSERT INTO devices(id,user_id,name,active,public_key) VALUES($1,$2,'Old owner',false,$3)",
      [
        deviceId,
        f.owner,
        keys.publicKey
          .export({ type: "spki", format: "der" })
          .toString("base64"),
      ],
    );
    const upload = async (path, payload, operationType = "unsupported") => {
      const message = {
        deviceId,
        businessId: f.business,
        operationId: payload.operationId ?? randomUUID(),
        payloadType: "online_action",
        originalRole: "owner",
        payload: { operationType, method: "POST", path, payload },
      };
      await uploadRevokedWork({
        ...message,
        signature: sign(
          null,
          Buffer.from(canonical(message)),
          keys.privateKey,
        ).toString("base64url"),
      });
      return message;
    };
    const original = await upload("/settings/activate-non-gst", {});
    assert.equal(
      (await listQuarantine(f.business)).find(
        (x) => x.operation_id === original.operationId,
      ).manual_reconciliation_available,
      true,
    );
    assert.equal(
      (await listQuarantine(f.business)).find(
        (x) => x.operation_id === original.operationId,
      ).original_actor_email,
      `${f.owner}@example.com`,
    );
    const before = (
      await pool.query(
        "SELECT count(*)::int count,sum(debt_delta_minor)::text debt FROM customer_ledger WHERE business_id=$1",
        [f.business],
      )
    ).rows[0];
    const input = {
      resolution: "already_applied",
      note: "Checked settings against original phone request",
      decisionOperationId: randomUUID(),
    };
    const result = await reconcileQuarantine(
      f.business,
      deviceId,
      original.operationId,
      f.owner,
      input,
    );
    assert.equal(result.decision, "reconciled");
    assert.equal(result.status, "manually_reconciled");
    assert.deepEqual(
      await reconcileQuarantine(
        f.business,
        deviceId,
        original.operationId,
        f.owner,
        input,
      ),
      result,
    );
    await assert.rejects(
      reconcileQuarantine(f.business, deviceId, original.operationId, f.owner, {
        ...input,
        note: "Changed",
      }),
      /different payload/,
    );
    await assert.rejects(
      reconcileQuarantine(f.business, deviceId, original.operationId, f.owner, {
        ...input,
        decisionOperationId: randomUUID(),
      }),
      /already decided/,
    );
    assert.deepEqual(
      (
        await pool.query(
          "SELECT count(*)::int count,sum(debt_delta_minor)::text debt FROM customer_ledger WHERE business_id=$1",
          [f.business],
        )
      ).rows[0],
      before,
    );
    const saved = (
      await pool.query(
        "SELECT payload,decision FROM quarantined_operations WHERE operation_id=$1",
        [original.operationId],
      )
    ).rows[0];
    assert.deepEqual(saved.payload, original.payload);
    assert.equal(saved.decision, "reconciled");
    assert.equal(
      (
        await pool.query(
          "SELECT 1 FROM audit_events WHERE operation_id=$1 AND action='quarantine.manually_reconciled'",
          [input.decisionOperationId],
        )
      ).rowCount,
      1,
    );
    const financial = await upload(
      "/repayments",
      {
        customerId: f.customer,
        amountMinor: 10,
        note: "Do not manually close",
        operationId: randomUUID(),
      },
      "repayment.cash",
    );
    await assert.rejects(
      reconcileQuarantine(
        f.business,
        deviceId,
        financial.operationId,
        f.owner,
        { ...input, decisionOperationId: randomUUID() },
      ),
      /typed|financial|unsupported/i,
    );
    const other = await upload("/settings/document-series", {
      operationId: randomUUID(),
    });
    await assert.rejects(
      reconcileQuarantine(f.business, deviceId, other.operationId, f.staff, {
        ...input,
        decisionOperationId: randomUUID(),
      }),
      /owner/i,
    );
    const staffDevice = randomUUID(),
      sessionId = randomUUID();
    await pool.query(
      "INSERT INTO devices(id,user_id,name) VALUES($1,$2,'Staff')",
      [staffDevice, f.staff],
    );
    await pool.query(
      "INSERT INTO refresh_sessions(id,device_id,user_id,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day')",
      [sessionId, staffDevice, f.staff, randomUUID()],
    );
    const token = await issueToken({ id: f.staff }, sessionId);
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const denied = await fetch(
      `http://127.0.0.1:${server.address().port}/v1/businesses/${f.business}/quarantine/${deviceId}/${other.operationId}/reconcile`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...input, decisionOperationId: randomUUID() }),
      },
    );
    assert.equal(denied.status, 403);
    const discarded = await reconcileQuarantine(
      f.business,
      deviceId,
      other.operationId,
      f.owner,
      {
        resolution: "discarded",
        note: "Confirmed original was not applied",
        decisionOperationId: randomUUID(),
      },
    );
    assert.equal(discarded.resolution, "discarded");
    assert.equal(discarded.decision, "reconciled");
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
});
