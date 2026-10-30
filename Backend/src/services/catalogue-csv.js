import { parse as parseCsv } from "csv-parse/sync";
import { z } from "zod";
import { upsertItem } from "./catalogue.js";
import { transaction } from "../config.js";
import { hash } from "../utils/validation.js";
import { conversionFactor } from "../utils/validation.js";

const uuid = z.uuid();
const rowSchema = z
  .object({
    item_id: uuid,
    name: z.string().trim().min(1).max(160),
    canonical_unit: z.string().trim().min(1).max(60),
    unit_id: uuid,
    unit_label: z.string().trim().min(1).max(60),
    factor: conversionFactor,
    price_minor: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    expected_version: z.union([
      z.literal(""),
      z.coerce.number().int().positive(),
    ]),
    operation_id: uuid,
  })
  .strict();
export const template =
  "item_id,name,canonical_unit,unit_id,unit_label,factor,price_minor,expected_version,operation_id\n";
export function previewCatalogueCsv(csv) {
  let rows;
  try {
    rows = parseCsv(csv, {
      columns: true,
      bom: true,
      skip_empty_lines: true,
      trim: true,
      max_record_size: 2048,
    });
  } catch (error) {
    return { items: [], errors: [`CSV parse error: ${error.message}`] };
  }
  if (rows.length === 0) return { items: [], errors: ["CSV has no data rows"] };
  if (rows.length > 200)
    return { items: [], errors: ["Maximum 200 rows per import"] };
  const errors = [],
    groups = new Map(),
    unitIds = new Set();
  for (let i = 0; i < rows.length; i++) {
    const parsed = rowSchema.safeParse(rows[i]);
    if (!parsed.success) {
      errors.push(`Row ${i + 2}: invalid or missing field`);
      continue;
    }
    const r = parsed.data;
    if (unitIds.has(r.unit_id)) {
      errors.push(`Row ${i + 2}: duplicate unit ID`);
      continue;
    }
    unitIds.add(r.unit_id);
    const expected = r.expected_version === "" ? null : r.expected_version;
    const item = groups.get(r.item_id);
    if (
      item &&
      (item.name !== r.name ||
        item.canonicalUnit !== r.canonical_unit ||
        item.expectedVersion !== expected ||
        item.operationId !== r.operation_id)
    ) {
      errors.push(`Row ${i + 2}: item fields differ across units`);
      continue;
    }
    const target = item ?? {
      id: r.item_id,
      name: r.name,
      canonicalUnit: r.canonical_unit,
      expectedVersion: expected,
      operationId: r.operation_id,
      active: true,
      units: [],
    };
    if (
      target.units.some(
        (unit) => unit.label.toLowerCase() === r.unit_label.toLowerCase(),
      )
    ) {
      errors.push(`Row ${i + 2}: duplicate unit label`);
      continue;
    }
    target.units.push({
      id: r.unit_id,
      label: r.unit_label,
      factor: r.factor,
      priceMinor: r.price_minor,
      active: true,
    });
    groups.set(r.item_id, target);
  }
  return { items: [...groups.values()], errors };
}
export async function importCatalogueCsv(businessId, actorId, csv) {
  const preview = previewCatalogueCsv(csv);
  if (preview.errors.length)
    throw Object.assign(new Error(preview.errors.join("; ")), { status: 400 });
  return transaction(async (db) => {
    const results = [];
    for (const item of preview.items)
      results.push(await upsertItem(businessId, item.id, actorId, item, db));
    return { imported: results.length, results };
  });
}

// A read-only snapshot reports evidence, never infers a failed write from absence.
export async function catalogueImportStatus(businessId, actorId, csv) {
  const preview = previewCatalogueCsv(csv);
  if (preview.errors.length)
    throw Object.assign(new Error(preview.errors.join("; ")), { status: 400 });
  return transaction(
    async (db) => {
      const items = [];
      for (const intent of preview.items) {
        const { rows: operations } = await db.query(
          "SELECT actor_id,operation_type,payload_hash,result FROM operations WHERE business_id=$1 AND operation_id=$2",
          [businessId, intent.operationId],
        );
        const { rows: current } = await db.query(
          "SELECT version FROM items WHERE business_id=$1 AND id=$2",
          [businessId, intent.id],
        );
        const operation = operations[0],
          currentVersion = current[0]?.version ?? null;
        const matches =
          operation &&
          operation.actor_id === actorId &&
          operation.operation_type === "catalogue.item.upsert" &&
          operation.payload_hash === hash(intent);
        items.push({
          intent,
          currentVersion,
          status: operation
            ? matches
              ? "accepted"
              : "operation_conflict"
            : currentVersion !== intent.expectedVersion
              ? "version_conflict"
              : "not_applied",
          // Only disclose the result after verifying original actor, type and payload.
          ...(matches ? { acceptedResult: operation.result } : {}),
        });
      }
      return { items };
    },
    { readOnly: true },
  );
}
