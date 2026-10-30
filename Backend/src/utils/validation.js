import { createHash } from "node:crypto";
import { z } from "zod";
import { STATE_CODES, validGstin } from "../services/gst.js";
export const stateCode = z.string().refine((value) => STATE_CODES.has(value));
export const gstin = z.string().trim().refine(validGstin);
export const uuid = z.uuid();
export const conversionFactor = z
  .string()
  .regex(/^\d{1,9}(\.\d{1,6})?$/)
  .refine((value) => Number(value) > 0);
const unit = z.object({
  id: uuid,
  label: z.string().trim().min(1).max(60),
  factor: conversionFactor,
  priceMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  active: z.boolean().default(true),
});
export const itemInput = z
  .object({
    id: uuid,
    name: z.string().trim().min(1).max(160),
    hsn: z
      .string()
      .regex(/^\d{4,8}$/)
      .optional(),
    gstRateBps: z.number().int().min(0).max(10000).optional(),
    taxCategory: z.enum(["taxable", "nil_rated", "exempt"]).optional(),
    canonicalUnit: z.string().trim().min(1).max(60),
    units: z.array(unit).min(1).max(30),
    expectedVersion: z.number().int().positive().nullable().default(null),
    active: z.boolean().default(true),
    operationId: uuid,
  })
  .strict();
export const parse = (schema, value) => {
  const result = schema.safeParse(value);
  if (!result.success) {
    const error = new Error("Invalid input");
    error.status = 400;
    throw error;
  }
  return result.data;
};
export const canonical = (value) =>
  JSON.stringify(value, (_, v) =>
    v && !Array.isArray(v) && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
export const hash = (value) =>
  createHash("sha256").update(canonical(value)).digest("hex");
