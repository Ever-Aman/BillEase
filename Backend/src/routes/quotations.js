import { Router } from "express";
import { z } from "zod";
import { owner } from "../auth.js";
import { parse, uuid, stateCode } from "../utils/validation.js";
import {
  createQuotation,
  quotationDraft,
  getQuotation,
  listQuotations,
} from "../services/quotations.js";
import { writeQuotationPdf } from "../services/quotation-documents.js";
const router = Router({ mergeParams: true });
router.get("/quotations", owner, async (req, res) =>
  res.json(
    await listQuotations(
      req.params.businessId,
      parse(uuid.nullable(), req.query.after ?? null),
    ),
  ),
);
router.get("/quotations/:id", owner, async (req, res) =>
  res.json(
    await getQuotation(req.params.businessId, parse(uuid, req.params.id)),
  ),
);
router.get("/quotations/:id/pdf", owner, async (req, res) =>
  writeQuotationPdf(req.params.businessId, parse(uuid, req.params.id), res),
);
const line = z
  .object({
    id: uuid,
    itemId: uuid,
    unitId: uuid,
    catalogueVersion: z.number().int().positive(),
    quantityMilli: z.number().int().positive().max(100000000),
    priceMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict();
router.post("/quotations", owner, async (req, res) =>
  res.status(201).json(
    await createQuotation(
      req.params.businessId,
      req.user.id,
      parse(
        z
          .object({
            id: uuid,
            placeOfSupply: stateCode.optional(),
            reference: z.string().trim().min(1).max(80),
            customerId: uuid.nullable(),
            lines: z.array(line).min(1).max(100),
            operationId: uuid,
          })
          .strict(),
        req.body,
      ),
    ),
  ),
);
router.get("/quotations/:id/draft", owner, async (req, res) =>
  res.json(
    await quotationDraft(req.params.businessId, parse(uuid, req.params.id)),
  ),
);
export default router;
