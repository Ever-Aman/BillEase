import { pool, transaction } from "../config.js";
import { validateParty } from "./gst.js";
import { hash } from "../utils/validation.js";

export async function listDocumentSeries(businessId) {
  return (
    await pool.query(
      "SELECT financial_year,last_number FROM document_series WHERE business_id=$1 ORDER BY financial_year DESC",
      [businessId],
    )
  ).rows;
}
export async function initializeDocumentSeries(businessId, actorId, input) {
  return transaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [businessId]);
    const digest = hash(input);
    const old = (
      await db.query(
        "SELECT payload_hash,result FROM operations WHERE business_id=$1 AND operation_id=$2",
        [businessId, input.operationId],
      )
    ).rows[0];
    if (old) {
      if (old.payload_hash !== digest)
        throw Object.assign(
          new Error("Operation ID reused with different payload"),
          { status: 409 },
        );
      return old.result;
    }
    const [start, end] = input.financialYear.split("-");
    if (Number(start) < 2000 || end !== String(Number(start) + 1).slice(-2))
      throw Object.assign(new Error("Invalid financial year"), { status: 400 });
    const existing = await db.query(
      "SELECT 1 FROM bills WHERE business_id=$1 AND financial_year=$2 UNION ALL SELECT 1 FROM document_series WHERE business_id=$1 AND financial_year=$2 LIMIT 1",
      [businessId, input.financialYear],
    );
    if (existing.rowCount)
      throw Object.assign(
        new Error("Document series already configured or bills issued"),
        { status: 409 },
      );
    await db.query(
      "INSERT INTO document_series(business_id,financial_year,last_number) VALUES ($1,$2,$3)",
      [businessId, input.financialYear, input.lastNumber],
    );
    const result = {
      financialYear: input.financialYear,
      lastNumber: input.lastNumber,
      initialized: true,
    };
    await db.query(
      "INSERT INTO operations(business_id,operation_id,operation_type,actor_id,payload_hash,result) VALUES ($1,$2,'document_series.initialize',$3,$4,$5)",
      [businessId, input.operationId, actorId, digest, result],
    );
    await db.query(
      "INSERT INTO audit_events(business_id,actor_id,action,entity_id,operation_id) VALUES ($1,$2,'document_series.initialized',$1,$3)",
      [businessId, actorId, input.operationId],
    );
    return result;
  });
}
export async function activateNonGst(businessId, actorId) {
  return transaction(async (db) => {
    const result = await db.query(
      "UPDATE businesses SET document_mode='non_gst' WHERE id=$1 AND document_mode='unconfigured' RETURNING id,document_mode",
      [businessId],
    );
    if (!result.rowCount)
      throw Object.assign(new Error("Document mode already configured"), {
        status: 409,
      });
    await db.query(
      "INSERT INTO audit_events(business_id,actor_id,action,entity_id) VALUES ($1,$2,$3,$4)",
      [businessId, actorId, "document_mode.non_gst", businessId],
    );
    return result.rows[0];
  });
}
export async function updateDocumentProfile(businessId, actorId, input) {
  return transaction(async (db) => {
    const old =
      (
        await db.query(
          "SELECT document_profile FROM businesses WHERE id=$1 FOR UPDATE",
          [businessId],
        )
      ).rows[0]?.document_profile ?? {};
    const profile = {
      name: input.name,
      address: input.address,
      phone: input.phone,
      gstin: input.gstin ?? old.gstin ?? null,
      signatory: input.signatory ?? old.signatory ?? null,
      stateCode: input.stateCode ?? old.stateCode ?? null,
    };
    validateParty(profile);
    const { rows } = await db.query(
      "UPDATE businesses SET document_profile=$3,profile_version=profile_version+1 WHERE id=$1 AND profile_version=$2 RETURNING profile_version",
      [businessId, input.expectedVersion, profile],
    );
    if (!rows[0])
      throw Object.assign(new Error("Document profile version conflict"), {
        status: 409,
      });
    await db.query(
      "INSERT INTO audit_events(business_id,actor_id,action,entity_id) VALUES ($1,$2,$3,$4)",
      [businessId, actorId, "document_profile.update", businessId],
    );
    return { version: rows[0].profile_version };
  });
}

export async function getDocumentProfile(businessId) {
  const { rows } = await pool.query(
    "SELECT document_profile,profile_version,document_mode FROM businesses WHERE id=$1",
    [businessId],
  );
  const row = rows[0];
  if (!row)
    throw Object.assign(new Error("Business not found"), { status: 404 });
  return {
    profile: row.document_profile,
    version: row.profile_version,
    mode: row.document_mode,
  };
}
