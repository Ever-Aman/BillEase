import { Router } from "express";
import { owner } from "../auth.js";
import {
  getDocumentProfile,
  updateDocumentProfile,
} from "../services/settings.js";
import {
  initializeDocumentSeries,
  listDocumentSeries,
} from "../services/settings.js";
import { parse, uuid, stateCode, gstin } from "../utils/validation.js";
import { z } from "zod";
const router = Router({ mergeParams: true });
router.get("/settings/document-profile", owner, async (req, res) =>
  res.json(await getDocumentProfile(req.params.businessId)),
);
router.get("/settings/document-series", owner, async (req, res) =>
  res.json({ series: await listDocumentSeries(req.params.businessId) }),
);
router.post("/settings/document-series", owner, async (req, res) =>
  res.status(201).json(
    await initializeDocumentSeries(
      req.params.businessId,
      req.user.id,
      parse(
        z
          .object({
            financialYear: z.string().regex(/^\d{4}-\d{2}$/),
            lastNumber: z.number().int().min(0).max(1000000000),
            operationId: uuid,
          })
          .strict(),
        req.body,
      ),
    ),
  ),
);
router.post("/settings/activate-non-gst", owner, (_req, res) =>
  res
    .status(409)
    .json({
      error:
        "New non-GST activation is no longer supported; choose a registered document mode during admin business setup",
    }),
);
router.put("/settings/document-profile", owner, async (req, res) =>
  res.json(
    await updateDocumentProfile(
      req.params.businessId,
      req.user.id,
      parse(
        z
          .object({
            name: z.string().trim().min(1).max(160),
            address: z.string().trim().min(1).max(500),
            phone: z.string().trim().min(5).max(30),
            gstin: gstin.optional(),
            stateCode: stateCode.optional(),
            signatory: z.string().trim().min(1).max(100).optional(),
            expectedVersion: z.number().int().min(0),
          })
          .strict(),
        req.body,
      ),
    ),
  ),
);
export default router;
