import { Router } from "express";
import { z } from "zod";
import { owner } from "../auth.js";
import { parse } from "../utils/validation.js";
import { writeCompositionPreview } from "../services/composition-preview.js";
const router = Router({ mergeParams: true });
const line = z
  .object({
    hsn: z
      .string()
      .trim()
      .regex(/^\d{4,8}$/),
    description: z.string().trim().min(1).max(160),
    quantity: z.string().regex(/^\d{1,9}(\.\d{1,3})?$/),
    valueMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
router.post("/composition/preview", owner, async (req, res) =>
  writeCompositionPreview(
    req.params.businessId,
    parse(
      z
        .object({
          recipientName: z.string().trim().min(1).max(160),
          recipientAddress: z.string().trim().min(1).max(500),
          recipientGstin: z
            .string()
            .trim()
            .regex(/^[0-9A-Z]{15}$/)
            .optional(),
          lines: z.array(line).min(1).max(50),
        })
        .strict(),
      req.body,
    ),
    res,
  ),
);
export default router;
