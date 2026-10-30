import { transaction } from "../config.js";

const fields = [
  "baseMinor",
  "cgstMinor",
  "sgstMinor",
  "igstMinor",
  "grossMinor",
];
const zero = () => Object.fromEntries(fields.map((field) => [field, "0"]));
const difference = (original, reversed) =>
  Object.fromEntries(
    fields.map((field) => [
      field,
      String(BigInt(original[field]) - BigInt(reversed[field])),
    ]),
  );

// Operational totals use immutable saved amounts. Reversals retain their actual
// recording date, and cancelled bills remain in original sales to avoid deducting twice.
export async function gstSummary(businessId, from, to) {
  if (
    !Number.isFinite(new Date(from).getTime()) ||
    !Number.isFinite(new Date(to).getTime()) ||
    new Date(from) >= new Date(to)
  )
    throw Object.assign(new Error("Invalid report period"), { status: 400 });
  return transaction(
    async (db) => {
      const asOf = (await db.query("SELECT transaction_timestamp() as_of"))
        .rows[0].as_of;
      const { rows } = await db.query(
        `
      WITH entries AS (
        SELECT document_snapshot->'tax' tax,'original' source FROM bills
          WHERE business_id=$1 AND issued_at >= $2 AND issued_at < $3
        UNION ALL
        SELECT tax_snapshot,'reversed' FROM returns
          WHERE business_id=$1 AND created_at >= $2 AND created_at < $3
        UNION ALL
        SELECT tax_snapshot,'reversed' FROM line_cancellations
          WHERE business_id=$1 AND created_at >= $2 AND created_at < $3
      )
      SELECT tax->>'mode' mode,tax->>'taxType' tax_type,source,COUNT(*)::integer entry_count,
        SUM((CASE WHEN source='original' THEN tax->>'subtotalMinor' ELSE tax->>'taxableMinor' END)::numeric)::text base_minor,
        SUM((tax->>'cgstMinor')::numeric)::text cgst_minor,
        SUM((tax->>'sgstMinor')::numeric)::text sgst_minor,
        SUM((tax->>'igstMinor')::numeric)::text igst_minor,
        SUM((tax->>'totalMinor')::numeric)::text gross_minor
      FROM entries WHERE tax->>'mode' IN ('composition','regular_gst')
      GROUP BY tax->>'mode',tax->>'taxType',source ORDER BY mode,tax_type,source`,
        [businessId, from, to],
      );
      const groups = new Map();
      for (const row of rows) {
        const key = `${row.mode}:${row.tax_type}`;
        if (!groups.has(key))
          groups.set(key, {
            mode: row.mode,
            taxType: row.tax_type,
            original: zero(),
            reversed: zero(),
            originalDocumentCount: 0,
            reversalEntryCount: 0,
          });
        const group = groups.get(key);
        group[row.source] = {
          baseMinor: row.base_minor,
          cgstMinor: row.cgst_minor,
          sgstMinor: row.sgst_minor,
          igstMinor: row.igst_minor,
          grossMinor: row.gross_minor,
        };
        group[
          row.source === "original"
            ? "originalDocumentCount"
            : "reversalEntryCount"
        ] = row.entry_count;
      }
      const totals = { original: zero(), reversed: zero() };
      const modes = [...groups.values()].map((group) => {
        for (const source of ["original", "reversed"])
          for (const field of fields)
            totals[source][field] = String(
              BigInt(totals[source][field]) + BigInt(group[source][field]),
            );
        return { ...group, net: difference(group.original, group.reversed) };
      });
      totals.net = difference(totals.original, totals.reversed);
      const legacy = (
        await db.query(
          "SELECT COUNT(*)::integer bill_count,COALESCE(SUM(total_minor),0)::text gross_minor FROM bills WHERE business_id=$1 AND issued_at >= $2 AND issued_at < $3 AND document_snapshot->'tax' IS NULL",
          [businessId, from, to],
        )
      ).rows[0];
      return {
        kind: "operational_gst_summary",
        statutory: false,
        adjustmentsLegalStatus: "unissued",
        asOf,
        from,
        to,
        modes,
        totals,
        legacy: {
          billCount: legacy.bill_count,
          grossMinor: legacy.gross_minor,
        },
      };
    },
    { readOnly: true },
  );
}
