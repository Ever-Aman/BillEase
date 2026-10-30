import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import app from "../src/app.js";
import { pool } from "../src/config.js";
import { issueToken } from "../src/auth.js";
import { saleFixture } from "./helpers/fixtures.js";

if (
  process.env.APP_ENV !== "development" ||
  !new URL(process.env.DATABASE_URL).pathname.includes("_tdd_")
)
  throw new Error("Isolated development database required");
test("HTTP business routes retain scope, allow staff delivery, and deny owner data to staff", async () => {
  let server;
  try {
    const f = await saleFixture();
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
      sessions[role] = {
        device,
        session,
        token: await issueToken({ id: f[role] }, session),
      };
    }
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}/v1/businesses/${f.business}`;
    const identity = await fetch(
      `http://127.0.0.1:${server.address().port}/v1/me`,
      { headers: { Authorization: `Bearer ${sessions.owner.token}` } },
    );
    assert.equal(identity.status, 200);
    assert.equal((await identity.json()).user.id, f.owner);
    const get = (path, role) =>
      fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${sessions[role].token}` },
      });
    assert.equal(
      (await get("/settings/document-profile", "owner")).status,
      200,
    );
    assert.equal(
      (await get("/settings/document-profile", "staff")).status,
      403,
    );
    const catalogue = await get("/catalogue", "staff");
    assert.equal(catalogue.status, 200);
    assert.equal((await catalogue.json()).items[0].id, f.item);
    const delivery = await get(`/delivery/${f.bill}`, "staff");
    assert.equal(delivery.status, 200);
    const safe = await delivery.json();
    assert.equal(
      /price|amount|minor|balance/i.test(JSON.stringify(safe)),
      false,
    );
    assert.equal(
      (
        await get(
          "/reports/overview?from=2000-01-01T00:00:00Z&to=2100-01-01T00:00:00Z",
          "staff",
        )
      ).status,
      403,
    );
    assert.equal((await get(`/bills/${f.bill}/pdf`, "staff")).status, 403);
    const report = await get(
      "/reports/overview?from=2000-01-01T00:00:00Z&to=2100-01-01T00:00:00Z",
      "owner",
    );
    assert.equal(report.status, 200);
    assert.equal((await report.json()).sales[0].total_minor, "2000");
    const requested = await fetch(`${base}/requests`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessions.staff.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: randomUUID(),
        type: "bill_cancel",
        targetId: f.bill,
        payload: {},
        reason: "Staff request",
        operationId: randomUUID(),
      }),
    });
    assert.equal(requested.status, 201);
    const requestId = (await requested.json()).id;
    const audit = (
      await pool.query(
        "SELECT device_id,session_id FROM audit_events WHERE business_id=$1 AND action='request.create' AND entity_id=$2",
        [f.business, requestId],
      )
    ).rows[0];
    assert.equal(audit.device_id, sessions.staff.device);
    assert.equal(audit.session_id, sessions.staff.session);
    const other = await fetch(
      `http://127.0.0.1:${server.address().port}/v1/businesses/${randomUUID()}/catalogue`,
      { headers: { Authorization: `Bearer ${sessions.owner.token}` } },
    );
    assert.equal(other.status, 403);
    const deviceBase = `http://127.0.0.1:${server.address().port}/v1/me/devices`;
    const list = await fetch(deviceBase, {
      headers: { Authorization: `Bearer ${sessions.owner.token}` },
    });
    assert.match(list.headers.get("cache-control"), /no-store/);
    assert.equal((await list.json()).devices[0].id, sessions.owner.device);
    assert.equal(
      (
        await fetch(`${deviceBase}/${sessions.staff.device}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${sessions.owner.token}` },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(`${deviceBase}/${sessions.staff.device}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${sessions.staff.token}` },
        })
      ).status,
      200,
    );
    assert.equal((await get("/catalogue", "staff")).status, 401);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
});
