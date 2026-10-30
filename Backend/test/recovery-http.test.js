import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync, sign } from "node:crypto";
import { once } from "node:events";
import app from "../src/app.js";
import { pool } from "../src/config.js";
import { issueToken } from "../src/auth.js";
import { saleFixture } from "./helpers/fixtures.js";
import { canonical } from "../src/utils/validation.js";

test("revoked enrolled device can upload signed old work but cannot read, mutate, or approve it", async () => {
  let server;
  try {
    const f = await saleFixture(),
      deviceId = randomUUID(),
      sessionId = randomUUID(),
      keys = generateKeyPairSync("ed25519");
    await pool.query(
      "INSERT INTO devices(id,user_id,name,public_key,last_authorized_at) VALUES ($1,$2,'Old', $3,now())",
      [
        deviceId,
        f.staff,
        keys.publicKey
          .export({ type: "spki", format: "der" })
          .toString("base64"),
      ],
    );
    await pool.query(
      "INSERT INTO refresh_sessions(id,device_id,user_id,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day')",
      [sessionId, deviceId, f.staff, randomUUID()],
    );
    const token = await issueToken({ id: f.staff }, sessionId);
    const payload = {
      id: randomUUID(),
      name: "Recovered",
      phone: "12345678",
      locality: "Test",
      expectedVersion: null,
      active: true,
      operationId: randomUUID(),
    };
    const message = {
      deviceId,
      businessId: f.business,
      operationId: payload.operationId,
      payloadType: "customer",
      originalRole: "staff",
      payload,
    };
    const body = {
      ...message,
      signature: sign(
        null,
        Buffer.from(canonical(message)),
        keys.privateKey,
      ).toString("base64url"),
    };
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}/v1`;
    const upload = () =>
      fetch(base + "/recovery/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    assert.equal((await upload()).status, 403);
    await pool.query("UPDATE devices SET active=false WHERE id=$1", [deviceId]);
    assert.equal((await upload()).status, 202);
    assert.equal((await upload()).status, 202);
    for (const path of [
      "/me",
      `/businesses/${f.business}/customers`,
      `/businesses/${f.business}/quarantine`,
      `/businesses/${f.business}/sync?after=0`,
    ]) {
      assert.equal(
        (
          await fetch(base + path, {
            headers: { Authorization: `Bearer ${token}` },
          })
        ).status,
        401,
      );
    }
    assert.equal(
      (
        await fetch(
          base + `/businesses/${f.business}/customers/${payload.id}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          },
        )
      ).status,
      401,
    );
    assert.equal(
      (await pool.query("SELECT 1 FROM customers WHERE id=$1", [payload.id]))
        .rowCount,
      0,
    );
    const q = (
      await pool.query(
        "SELECT original_actor_id,original_role,claimed_role,device_signature,payload FROM quarantined_operations WHERE operation_id=$1",
        [payload.operationId],
      )
    ).rows[0];
    assert.equal(q.original_actor_id, f.staff);
    assert.equal(q.original_role, "staff");
    assert.equal(q.claimed_role, "staff");
    assert.equal(q.device_signature, body.signature);
    assert.deepEqual(q.payload, payload);
    await pool.query("UPDATE devices SET active=true WHERE id=$1", [deviceId]);
    await pool.query(
      "UPDATE memberships SET active=false WHERE user_id=$1 AND business_id=$2",
      [f.staff, f.business],
    );
    assert.equal((await upload()).status, 202);
    assert.equal(
      (
        await fetch(base + `/businesses/${f.business}/customers`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).status,
      403,
    );
    const forged = { ...body, businessId: randomUUID() };
    assert.equal(
      (
        await fetch(base + "/recovery/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(forged),
        })
      ).status,
      403,
    );
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
});
