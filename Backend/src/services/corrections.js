import { transaction } from "../config.js";
import { hash } from "../utils/validation.js";
import { allocateReceipt } from "./billing.js";
function fail(message, status = 409) {
  throw Object.assign(new Error(message), { status });
}
async function execute(businessId, actorId, input, type, fn, existingDb) {
  const run = async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [businessId]);
    const digest = hash(input),
      old = await db.query(
        "SELECT payload_hash,result FROM operations WHERE business_id=$1 AND operation_id=$2",
        [businessId, input.operationId],
      );
    if (old.rows[0]) {
      if (old.rows[0].payload_hash !== digest)
        fail("Operation ID reused with different payload");
      return old.rows[0].result;
    }
    const result = await fn(db);
    await db.query(
      "INSERT INTO operations(business_id,operation_id,operation_type,actor_id,payload_hash,result) VALUES ($1,$2,$3,$4,$5,$6)",
      [businessId, input.operationId, type, actorId, digest, result],
    );
    await db.query(
      "INSERT INTO audit_events(business_id,actor_id,action,entity_id,operation_id) VALUES ($1,$2,$3,$4,$5)",
      [businessId, actorId, type, input.id, input.operationId],
    );
    return result;
  };
  return existingDb ? run(existingDb) : transaction(run);
}
export async function correctPayment(businessId, actorId, input, existingDb) {
  return execute(
    businessId,
    actorId,
    input,
    "payment.correct",
    async (db) => {
      const payment = await db.query(
        "SELECT p.*,b.customer_id FROM payments p JOIN bills b ON b.business_id=p.business_id AND b.id=p.bill_id WHERE p.business_id=$1 AND p.id=$2 FOR UPDATE OF p",
        [businessId, input.paymentId],
      );
      const p = payment.rows[0];
      if (!p || p.corrected_at) fail("Payment unavailable for correction");
      await db.query(
        "UPDATE payments SET corrected_at=now() WHERE business_id=$1 AND id=$2",
        [businessId, input.paymentId],
      );
      if (p.state === "confirmed" && p.customer_id) {
        const allocation = await db.query(
          "SELECT COALESCE(SUM(debt_delta_minor),0)::text debt,COALESCE(SUM(advance_delta_minor),0)::text advance FROM customer_ledger WHERE business_id=$1 AND payment_id=$2",
          [businessId, p.id],
        );
        await db.query(
          "INSERT INTO customer_ledger(business_id,customer_id,bill_id,payment_id,debt_delta_minor,advance_delta_minor,actor_id,note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            businessId,
            p.customer_id,
            p.bill_id,
            p.id,
            (-BigInt(allocation.rows[0].debt)).toString(),
            (-BigInt(allocation.rows[0].advance)).toString(),
            actorId,
            `Payment correction: ${input.reason}`,
          ],
        );
        const balance = await db.query(
          "SELECT COALESCE(SUM(advance_delta_minor),0)::text advance FROM customer_ledger WHERE business_id=$1 AND customer_id=$2",
          [businessId, p.customer_id],
        );
        if (BigInt(balance.rows[0].advance) < 0n)
          fail("Payment advance has already been used; reconcile it first");
      }
      if (input.replacement) {
        const replacement = input.replacement;
        await db.query(
          "INSERT INTO payments(id,business_id,bill_id,method,amount_minor,state,actor_id,occurrence_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            replacement.id,
            businessId,
            p.bill_id,
            replacement.method,
            replacement.amountMinor,
            replacement.method === "cash" ? "confirmed" : "pending",
            actorId,
            replacement.occurrenceAt,
          ],
        );
        if (replacement.method === "cash" && p.customer_id)
          await allocateReceipt(
            db,
            businessId,
            p.customer_id,
            p.bill_id,
            replacement.id,
            BigInt(replacement.amountMinor),
            actorId,
          );
      }
      await db.query(
        "INSERT INTO payment_corrections(id,business_id,payment_id,replacement_payment_id,actor_id,reason) VALUES ($1,$2,$3,$4,$5,$6)",
        [
          input.id,
          businessId,
          input.paymentId,
          input.replacement?.id ?? null,
          actorId,
          input.reason,
        ],
      );
      await db.query(
        "INSERT INTO change_log(business_id,kind,entity_id,version) VALUES ($1,$2,$3,1)",
        [businessId, "bill", p.bill_id],
      );
      if (p.customer_id)
        await db.query(
          "INSERT INTO change_log(business_id,kind,entity_id,version) VALUES ($1,$2,$3,1)",
          [businessId, "customer_balance", p.customer_id],
        );
      return {
        id: input.id,
        paymentId: input.paymentId,
        replacementPaymentId: input.replacement?.id ?? null,
        corrected: true,
      };
    },
    existingDb,
  );
}
export async function correctDelivery(businessId, actorId, input, existingDb) {
  return execute(
    businessId,
    actorId,
    input,
    "delivery.correct",
    async (db) => {
      const event = await db.query(
        "SELECT e.id,e.bill_id,e.canonical_quantity,(q.delivered_canonical-e.canonical_quantity>=q.returned_canonical) safe FROM delivery_events e JOIN bill_line_quantities q ON q.business_id=e.business_id AND q.line_id=e.line_id WHERE e.business_id=$1 AND e.id=$2",
        [businessId, input.deliveryId],
      );
      if (!event.rowCount) fail("Delivery unavailable", 404);
      if (!event.rows[0].safe)
        fail("Delivery correction would erase quantities already returned");
      await db.query(
        "INSERT INTO delivery_corrections(id,business_id,delivery_id,actor_id,reason,canonical_reversal) VALUES ($1,$2,$3,$4,$5,$6)",
        [
          input.id,
          businessId,
          input.deliveryId,
          actorId,
          input.reason,
          event.rows[0].canonical_quantity,
        ],
      );
      await db.query(
        "INSERT INTO change_log(business_id,kind,entity_id,version) VALUES ($1,$2,$3,1)",
        [businessId, "bill", event.rows[0].bill_id],
      );
      return { id: input.id, deliveryId: input.deliveryId, corrected: true };
    },
    existingDb,
  );
}
