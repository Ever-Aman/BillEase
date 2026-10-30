import { pool, transaction } from "../config.js";

export async function overview(businessId, from, to) {
  return transaction(
    async (db) => {
      const asOf = (await db.query("SELECT transaction_timestamp() as_of"))
        .rows[0].as_of;
      const period = [businessId, from, to];
      const read = (sql, params) => ({ sql, params });
      const queries = [
        read(
          "SELECT financial_year,lifecycle,review_state,COUNT(*)::integer bill_count,COALESCE(SUM(total_minor),0)::text total_minor FROM bills WHERE business_id=$1 AND issued_at >= $2 AND issued_at < $3 GROUP BY financial_year,lifecycle,review_state ORDER BY financial_year,lifecycle,review_state",
          period,
        ),
        read(
          `SELECT method,SUM(amount)::bigint::text amount_minor FROM (
        SELECT method,amount_minor amount FROM payments WHERE business_id=$1 AND received_at >= $2 AND received_at < $3 AND state='confirmed'
        UNION ALL SELECT 'cash',(result->>'debtPaidMinor')::bigint+(result->>'advanceAddedMinor')::bigint FROM operations WHERE business_id=$1 AND created_at >= $2 AND created_at < $3 AND operation_type='repayment.cash'
        ) receipts GROUP BY method ORDER BY method`,
          period,
        ),
        read(
          `SELECT method,SUM(amount)::bigint::text amount_minor FROM (
        SELECT p.method,p.amount_minor amount FROM payment_corrections c JOIN payments p ON p.business_id=c.business_id AND p.id=c.payment_id WHERE c.business_id=$1 AND c.created_at >= $2 AND c.created_at < $3 AND p.state='confirmed'
        UNION ALL SELECT 'cash',-l.debt_delta_minor+l.advance_delta_minor FROM ledger_corrections c JOIN customer_ledger l ON l.id=c.original_entry_id WHERE c.business_id=$1 AND c.created_at >= $2 AND c.created_at < $3 AND l.source_type='repayment'
        ) reversals GROUP BY method ORDER BY method`,
          period,
        ),
        read(
          "SELECT method,state,SUM(amount_minor)::bigint::text amount_minor,COUNT(*)::integer claim_count FROM payments WHERE business_id=$1 AND received_at >= $2 AND received_at < $3 AND state<>'confirmed' AND corrected_at IS NULL GROUP BY method,state ORDER BY method,state",
          period,
        ),
        read(
          "SELECT method,SUM(amount_minor)::bigint::text amount_minor FROM refunds WHERE business_id=$1 AND created_at >= $2 AND created_at < $3 GROUP BY method ORDER BY method",
          period,
        ),
        read(
          "SELECT COUNT(*)::integer return_count,COALESCE(SUM(value_minor),0)::text returned_value_minor FROM returns WHERE business_id=$1 AND created_at >= $2 AND created_at < $3",
          period,
        ),
        read(
          "SELECT COUNT(*)::integer cancelled_line_count,COALESCE(SUM(value_minor),0)::text cancelled_value_minor FROM line_cancellations WHERE business_id=$1 AND created_at >= $2 AND created_at < $3",
          period,
        ),
        read(
          "SELECT COALESCE(SUM(debt_delta_minor),0)::text debt_minor,COALESCE(SUM(advance_delta_minor),0)::text advance_minor FROM customer_ledger WHERE business_id=$1",
          [businessId],
        ),
        read(
          "SELECT COUNT(*)::integer event_count,COUNT(*) FILTER(WHERE coverage_conflict)::integer coverage_conflict_count FROM delivery_events WHERE business_id=$1 AND received_at >= $2 AND received_at < $3",
          period,
        ),
        read(
          "SELECT COUNT(*)::integer line_count,COUNT(*) FILTER(WHERE billed_canonical>delivered_canonical+cancelled_canonical)::integer pending_line_count,COUNT(*) FILTER(WHERE delivered_canonical+cancelled_canonical>billed_canonical)::integer discrepancy_line_count FROM bill_line_quantities WHERE business_id=$1",
          [businessId],
        ),
        read(
          `SELECT (SELECT COUNT(*) FROM bills WHERE business_id=$1 AND lifecycle='issued' AND review_state='credit_pending')::integer credit_count,
        (SELECT COUNT(*) FROM payments WHERE business_id=$1 AND state='pending' AND corrected_at IS NULL)::integer payment_count,
        (SELECT COUNT(*) FROM delivery_events WHERE business_id=$1 AND state IN ('review_pending','disputed'))::integer delivery_count,
        (SELECT COUNT(*) FROM requests WHERE business_id=$1 AND state='pending')::integer request_count,
        (SELECT COUNT(*) FROM sync_conflicts WHERE business_id=$1 AND status='open')::integer conflict_count`,
          [businessId],
        ),
        read(
          "SELECT d.id,d.last_seen_at,d.active device_active,m.active membership_active FROM devices d JOIN memberships m ON m.user_id=d.user_id WHERE m.business_id=$1 ORDER BY d.last_seen_at,d.id",
          [businessId],
        ),
        read(
          "SELECT decision,COUNT(*)::integer operation_count FROM quarantined_operations WHERE business_id=$1 GROUP BY decision ORDER BY decision",
          [businessId],
        ),
      ];
      const results = [];
      for (const { sql, params } of queries)
        results.push(await db.query(sql, params));
      const [
        sales,
        receipts,
        reversals,
        claims,
        refunds,
        returns,
        cancellations,
        balances,
        deliveries,
        fulfilment,
        review,
        devices,
        quarantine,
      ] = results;
      return {
        asOf,
        from,
        to,
        sales: sales.rows,
        confirmedReceipts: receipts.rows,
        receiptReversals: reversals.rows,
        unverifiedClaims: claims.rows,
        refunds: refunds.rows,
        returns: returns.rows[0],
        cancellations: cancellations.rows[0],
        balances: balances.rows[0],
        delivery: deliveries.rows[0],
        fulfilment: fulfilment.rows[0],
        pendingReview: review.rows[0],
        devices: devices.rows,
        quarantine: quarantine.rows,
        unsyncedDeviceWork: "unknown",
      };
    },
    { readOnly: true },
  );
}

export async function fulfilmentRows(businessId, afterId = null) {
  const { rows } = await pool.query(
    `SELECT l.id,l.bill_id,l.item_name,l.canonical_unit,q.billed_canonical::text,q.delivered_canonical::text,
      q.returned_canonical::text,q.cancelled_canonical::text,
      GREATEST(q.billed_canonical-q.delivered_canonical-q.cancelled_canonical,0)::text pending_canonical,
      GREATEST(q.delivered_canonical+q.cancelled_canonical-q.billed_canonical,0)::text excess_canonical
      FROM bill_lines l JOIN bill_line_quantities q ON q.business_id=l.business_id AND q.line_id=l.id
      WHERE l.business_id=$1 AND ($2::uuid IS NULL OR l.id>$2::uuid) ORDER BY l.id LIMIT 101`,
    [businessId, afterId],
  );
  const lines = rows.slice(0, 100);
  return {
    lines,
    nextCursor: lines.at(-1)?.id ?? afterId,
    hasMore: rows.length > 100,
  };
}

export async function customerHistory(businessId, customerId, afterId = "0") {
  const { rows } = await pool.query(
    "SELECT id,bill_id,payment_id,debt_delta_minor::text,advance_delta_minor::text,note,actor_id,source_type,source_operation_id,occurrence_at,created_at FROM customer_ledger WHERE business_id=$1 AND customer_id=$2 AND id>$3::bigint ORDER BY id LIMIT 501",
    [businessId, customerId, afterId],
  );
  return rows;
}
