import { pool, transaction } from "../config.js";
import { hash } from "../utils/validation.js";

function fail(message, status = 409) {
  throw Object.assign(new Error(message), { status });
}
async function balances(db, businessId, customerId) {
  const { rows } = await db.query(
    "SELECT COALESCE(SUM(debt_delta_minor),0)::text debt_minor,COALESCE(SUM(advance_delta_minor),0)::text advance_minor FROM customer_ledger WHERE business_id=$1 AND customer_id=$2",
    [businessId, customerId],
  );
  return {
    debt: BigInt(rows[0].debt_minor),
    advance: BigInt(rows[0].advance_minor),
  };
}
async function withOperation(
  businessId,
  actorId,
  input,
  type,
  action,
  existingDb,
) {
  const run = async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [businessId]);
    const digest = hash(input);
    const { rows } = await db.query(
      "SELECT payload_hash,result FROM operations WHERE business_id=$1 AND operation_id=$2",
      [businessId, input.operationId],
    );
    if (rows[0]) {
      if (rows[0].payload_hash !== digest)
        fail("Operation ID reused with different payload");
      return rows[0].result;
    }
    const result = await action(db);
    if (input.customerId)
      await db.query(
        "INSERT INTO change_log(business_id,kind,entity_id,version) VALUES ($1,$2,$3,1)",
        [businessId, "customer_balance", input.customerId],
      );
    await db.query(
      "INSERT INTO operations(business_id,operation_id,operation_type,actor_id,payload_hash,result) VALUES ($1,$2,$3,$4,$5,$6)",
      [businessId, input.operationId, type, actorId, digest, result],
    );
    await db.query(
      "INSERT INTO audit_events(business_id,actor_id,action,entity_id,operation_id) VALUES ($1,$2,$3,$4,$5)",
      [businessId, actorId, type, input.customerId, input.operationId],
    );
    return result;
  };
  return existingDb ? run(existingDb) : transaction(run);
}
export async function getBalance(businessId, customerId) {
  const b = await balances(pool, businessId, customerId);
  return { debtMinor: b.debt.toString(), advanceMinor: b.advance.toString() };
}
export async function openingBalance(businessId, actorId, input, existingDb) {
  return withOperation(
    businessId,
    actorId,
    input,
    "balance.opening",
    async (db) => {
      const customer = await db.query(
        "SELECT id FROM customers WHERE business_id=$1 AND id=$2 AND active=true",
        [businessId, input.customerId],
      );
      if (!customer.rowCount) fail("Customer unavailable", 404);
      const entry = await db.query(
        "INSERT INTO customer_ledger(business_id,customer_id,debt_delta_minor,advance_delta_minor,actor_id,note,source_type,source_operation_id,occurrence_at) VALUES ($1,$2,$3,$4,$5,$6,'opening_balance',$7,COALESCE($8::timestamptz,now())) RETURNING id",
        [
          businessId,
          input.customerId,
          input.kind === "debt" ? input.amountMinor : 0,
          input.kind === "advance" ? input.amountMinor : 0,
          actorId,
          input.note,
          input.operationId,
          input.occurrenceAt ?? null,
        ],
      );
      return {
        entryId: entry.rows[0].id,
        customerId: input.customerId,
        kind: input.kind,
        amountMinor: String(input.amountMinor),
      };
    },
    existingDb,
  );
}
export async function recordRepayment(businessId, actorId, input, existingDb) {
  return withOperation(
    businessId,
    actorId,
    input,
    "repayment.cash",
    async (db) => {
      const customer = await db.query(
        "SELECT id FROM customers WHERE business_id=$1 AND id=$2 AND active=true",
        [businessId, input.customerId],
      );
      if (!customer.rowCount) fail("Customer unavailable", 404);
      const before = await balances(db, businessId, input.customerId);
      const amount = BigInt(input.amountMinor),
        debtPaid = amount < before.debt ? amount : before.debt,
        advanceAdded = amount - debtPaid;
      const entry = await db.query(
        "INSERT INTO customer_ledger(business_id,customer_id,debt_delta_minor,advance_delta_minor,actor_id,note,source_type,source_operation_id,occurrence_at) VALUES ($1,$2,$3,$4,$5,$6,'repayment',$7,COALESCE($8::timestamptz,now())) RETURNING id",
        [
          businessId,
          input.customerId,
          (-debtPaid).toString(),
          advanceAdded.toString(),
          actorId,
          input.note,
          input.operationId,
          input.occurrenceAt ?? null,
        ],
      );
      return {
        entryId: entry.rows[0].id,
        customerId: input.customerId,
        debtPaidMinor: debtPaid.toString(),
        advanceAddedMinor: advanceAdded.toString(),
      };
    },
    existingDb,
  );
}
export async function applyAdvance(businessId, actorId, input, existingDb) {
  return withOperation(
    businessId,
    actorId,
    input,
    "advance.apply",
    async (db) => {
      const bill = await db.query(
        "SELECT customer_id,total_minor FROM bills WHERE business_id=$1 AND id=$2 AND lifecycle=$3",
        [businessId, input.billId, "issued"],
      );
      if (bill.rows[0]?.customer_id !== input.customerId)
        fail("Bill and customer mismatch", 400);
      const before = await balances(db, businessId, input.customerId),
        amount = BigInt(input.amountMinor);
      const paid = await db.query(
        "SELECT COALESCE(SUM(amount_minor),0)::text amount FROM payments WHERE business_id=$1 AND bill_id=$2 AND state='confirmed' AND corrected_at IS NULL",
        [businessId, input.billId],
      );
      const applied = await db.query(
        "SELECT COALESCE(-SUM(advance_delta_minor),0)::text amount FROM customer_ledger WHERE business_id=$1 AND bill_id=$2 AND advance_delta_minor<0",
        [businessId, input.billId],
      );
      const adjustments = (
        await db.query(
          `SELECT (SELECT COALESCE(SUM(value_minor),0) FROM returns WHERE business_id=$1 AND bill_id=$2)
          +(SELECT COALESCE(SUM(value_minor),0) FROM line_cancellations WHERE business_id=$1 AND bill_id=$2) reduced,
          (SELECT COALESCE(SUM(amount_minor),0) FROM refunds WHERE business_id=$1 AND bill_id=$2) refunded,
          (SELECT COALESCE(SUM(advance_delta_minor),0) FROM customer_ledger WHERE business_id=$1 AND bill_id=$2 AND advance_delta_minor>0) credited`,
          [businessId, input.billId],
        )
      ).rows[0];
      const due =
        BigInt(bill.rows[0].total_minor) -
        BigInt(adjustments.reduced) -
        BigInt(paid.rows[0].amount) -
        BigInt(applied.rows[0].amount) +
        BigInt(adjustments.refunded) +
        BigInt(adjustments.credited);
      if (amount > before.advance || amount > due || amount > before.debt)
        fail("Advance exceeds available balance or bill due");
      await db.query(
        "INSERT INTO customer_ledger(business_id,customer_id,bill_id,debt_delta_minor,advance_delta_minor,actor_id,note) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [
          businessId,
          input.customerId,
          input.billId,
          (-amount).toString(),
          (-amount).toString(),
          actorId,
          "Advance applied",
        ],
      );
      return { billId: input.billId, amountMinor: amount.toString() };
    },
    existingDb,
  );
}
