import { randomUUID } from "node:crypto";
import { transaction } from "../config.js";
import { hash } from "../utils/validation.js";
import { openingBalance, recordRepayment } from "./finance.js";

function fail(message, status = 409) {
  throw Object.assign(new Error(message), { status });
}
export async function correctLedgerEntry(
  businessId,
  actorId,
  input,
  existingDb,
) {
  const run = async (db) => {
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
        fail("Operation ID reused with different payload");
      return old.result;
    }
    const original = (
      await db.query(
        "SELECT l.* FROM customer_ledger l WHERE l.business_id=$1 AND l.id=$2 AND NOT EXISTS(SELECT 1 FROM ledger_corrections c WHERE c.business_id=l.business_id AND c.original_entry_id=l.id)",
        [businessId, input.entryId],
      )
    ).rows[0];
    if (
      !original ||
      !["opening_balance", "repayment"].includes(original.source_type)
    )
      fail("Opening balance or repayment entry unavailable for correction");
    if (
      input.replacement &&
      (original.source_type === "opening_balance") !==
        Boolean(input.replacement.openingKind)
    )
      fail(
        "Opening replacement requires its debt or advance kind; repayment replacement uses amount only",
        400,
      );
    const reversal = (
      await db.query(
        "INSERT INTO customer_ledger(business_id,customer_id,debt_delta_minor,advance_delta_minor,actor_id,note,source_type,source_operation_id) VALUES ($1,$2,$3,$4,$5,$6,'correction',$7) RETURNING id",
        [
          businessId,
          original.customer_id,
          (-BigInt(original.debt_delta_minor)).toString(),
          (-BigInt(original.advance_delta_minor)).toString(),
          actorId,
          `Correction: ${input.reason}`,
          input.operationId,
        ],
      )
    ).rows[0];
    let replacementEntryId = null;
    if (input.replacement) {
      const replacement = {
        customerId: original.customer_id,
        amountMinor: input.replacement.amountMinor,
        occurrenceAt:
          input.replacement.occurrenceAt ??
          original.occurrence_at.toISOString(),
        note: `Replacement: ${input.reason}`,
        operationId: randomUUID(),
      };
      const result =
        original.source_type === "opening_balance"
          ? await openingBalance(
              businessId,
              actorId,
              { ...replacement, kind: input.replacement.openingKind },
              db,
            )
          : await recordRepayment(businessId, actorId, replacement, db);
      replacementEntryId = result.entryId;
    }
    const balance = (
      await db.query(
        "SELECT COALESCE(SUM(debt_delta_minor),0)<0 OR COALESCE(SUM(advance_delta_minor),0)<0 invalid FROM customer_ledger WHERE business_id=$1 AND customer_id=$2",
        [businessId, original.customer_id],
      )
    ).rows[0];
    if (balance.invalid)
      fail(
        "Correction would create a negative balance; reconcile already used funds first",
      );
    await db.query(
      "INSERT INTO ledger_corrections(business_id,original_entry_id,reversal_entry_id,replacement_entry_id,operation_id,actor_id,reason) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [
        businessId,
        input.entryId,
        reversal.id,
        replacementEntryId,
        input.operationId,
        actorId,
        input.reason,
      ],
    );
    const result = {
      entryId: input.entryId,
      reversalEntryId: reversal.id,
      replacementEntryId,
      corrected: true,
    };
    await db.query(
      "INSERT INTO operations(business_id,operation_id,operation_type,actor_id,payload_hash,result) VALUES ($1,$2,'ledger.correct',$3,$4,$5)",
      [businessId, input.operationId, actorId, digest, result],
    );
    await db.query(
      "INSERT INTO audit_events(business_id,actor_id,action,entity_id,operation_id) VALUES ($1,$2,'ledger.correct',$3,$4)",
      [businessId, actorId, original.customer_id, input.operationId],
    );
    await db.query(
      "INSERT INTO change_log(business_id,kind,entity_id,version) VALUES ($1,'customer_balance',$2,1)",
      [businessId, original.customer_id],
    );
    return result;
  };
  return existingDb ? run(existingDb) : transaction(run);
}
