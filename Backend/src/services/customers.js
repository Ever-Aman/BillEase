import { pool, transaction } from "../config.js";
import { validateParty } from "./gst.js";
import { hash } from "../utils/validation.js";

export async function listCustomers(businessId, search) {
  const { rows } = await pool.query(
    'SELECT id,name,phone,locality,version,active,gstin,address,state_code AS "stateCode" FROM customers WHERE business_id=$1 AND active=true AND ($2::text IS NULL OR name ILIKE $2 OR phone ILIKE $2) ORDER BY name LIMIT 100',
    [businessId, search ? `%${search}%` : null],
  );
  return rows;
}

export async function upsertCustomer(businessId, actorId, input, existingDb) {
  const run = async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [businessId]);
    const payloadHash = hash(input);
    const old = await db.query(
      "SELECT payload_hash,result FROM operations WHERE business_id=$1 AND operation_id=$2",
      [businessId, input.operationId],
    );
    if (old.rows[0]) {
      if (old.rows[0].payload_hash !== payloadHash)
        throw Object.assign(
          new Error("Operation ID reused with different payload"),
          { status: 409 },
        );
      return old.rows[0].result;
    }
    const current = await db.query(
      "SELECT version,gstin,address,state_code FROM customers WHERE business_id=$1 AND id=$2 FOR UPDATE",
      [businessId, input.id],
    );
    const version = current.rows[0]?.version ?? null;
    if (version !== input.expectedVersion)
      throw Object.assign(new Error("Customer version conflict"), {
        status: 409,
      });
    const next = (version ?? 0) + 1;
    const tax = {
      gstin: input.gstin ?? current.rows[0]?.gstin ?? null,
      address: input.address ?? current.rows[0]?.address ?? null,
      stateCode: input.stateCode ?? current.rows[0]?.state_code ?? null,
    };
    validateParty(tax);
    if (version)
      await db.query(
        "UPDATE customers SET name=$3,phone=$4,locality=$5,version=$6,active=$7,updated_at=now() WHERE business_id=$1 AND id=$2",
        [
          businessId,
          input.id,
          input.name,
          input.phone,
          input.locality,
          next,
          input.active,
        ],
      );
    else
      await db.query(
        "INSERT INTO customers(id,business_id,name,phone,locality,version,active) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [
          input.id,
          businessId,
          input.name,
          input.phone,
          input.locality,
          next,
          input.active,
        ],
      );
    await db.query(
      "UPDATE customers SET gstin=$3,address=$4,state_code=$5 WHERE business_id=$1 AND id=$2",
      [businessId, input.id, tax.gstin, tax.address, tax.stateCode],
    );
    const snapshot = {
      ...tax,
      id: input.id,
      name: input.name,
      phone: input.phone,
      locality: input.locality,
      version: next,
      active: input.active,
    };
    await db.query(
      "INSERT INTO customer_revisions(business_id,customer_id,version,snapshot,actor_id) VALUES ($1,$2,$3,$4,$5)",
      [businessId, input.id, next, snapshot, actorId],
    );
    const { rows } = await db.query(
      "INSERT INTO change_log(business_id,kind,entity_id,version) VALUES ($1,$2,$3,$4) RETURNING cursor",
      [businessId, "customer", input.id, next],
    );
    const result = { ...snapshot, cursor: String(rows[0].cursor) };
    await db.query(
      "INSERT INTO operations(business_id,operation_id,operation_type,actor_id,payload_hash,result) VALUES ($1,$2,$3,$4,$5,$6)",
      [
        businessId,
        input.operationId,
        "customer.upsert",
        actorId,
        payloadHash,
        result,
      ],
    );
    await db.query(
      "INSERT INTO audit_events(business_id,actor_id,action,entity_id,operation_id) VALUES ($1,$2,$3,$4,$5)",
      [businessId, actorId, "customer.upsert", input.id, input.operationId],
    );
    return result;
  };
  return existingDb ? run(existingDb) : transaction(run);
}
