import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { directPool, pool, environment } from "./config.js";

const migrations = [
  "001_foundation.sql",
  "002_customers.sql",
  "003_billing.sql",
  "004_workflows.sql",
  "005_documents.sql",
  "006_corrections.sql",
  "007_quotations.sql",
  "008_recovery.sql",
  "009_offline_lease.sql",
  "010_quarantine.sql",
  "011_requests.sql",
  "012_push.sql",
  "013_rate_limits.sql",
  "014_payment_replacement.sql",
  "015_sync_conflicts.sql",
  "016_quarantine_decisions.sql",
  "017_adjustment_quantities.sql",
  "018_delivery_authorizations.sql",
  "019_bill_balance_snapshot.sql",
  "020_ledger_corrections.sql",
  "021_pending_mfa.sql",
  "022_quotation_snapshots.sql",
  "023_bill_catalogue_flags.sql",
  "024_audit_device_context.sql",
  "025_ledger_occurrence.sql",
  "026_admin_web.sql",
  "027_recovery_provenance.sql",
  "028_recovery_reconciliation.sql",
  "029_gst.sql",
  "030_gst_adjustments.sql",
];
const client = await directPool.connect();
try {
  await client.query("BEGIN");
  for (const name of migrations)
    await client.query(
      await readFile(
        fileURLToPath(new URL(`../migrations/${name}`, import.meta.url)),
        "utf8",
      ),
    );
  await client.query(
    "INSERT INTO deployment_identity(id, environment) VALUES (1,$1) ON CONFLICT (id) DO NOTHING",
    [environment],
  );
  const { rows } = await client.query(
    "SELECT environment FROM deployment_identity WHERE id=1",
  );
  if (rows[0].environment !== environment)
    throw new Error("Database environment mismatch");
  await client.query("COMMIT");
  console.log(`Migration complete for ${environment}`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  if (pool !== directPool) await pool.end();
  await directPool.end();
}
