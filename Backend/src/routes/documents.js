import { Router } from "express";
import { owner } from "../auth.js";
import { parse, uuid } from "../utils/validation.js";
import { z } from "zod";
import {
  writeBillPdf,
  writeBillAdjustmentsPdf,
} from "../services/documents.js";
const router = Router({ mergeParams: true });
router.get("/bills/:billId/pdf", owner, async (req, res) => {
  const booleanQuery = z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true");
  const options = parse(
    z
      .object({ showPayments: booleanQuery, showPriorDebt: booleanQuery })
      .strict(),
    req.query,
  );
  return writeBillPdf(
    req.params.businessId,
    parse(uuid, req.params.billId),
    req.user.id,
    res,
    options,
  );
});
router.get("/bills/:billId/adjustments/pdf", owner, async (req, res) =>
  writeBillAdjustmentsPdf(
    req.params.businessId,
    parse(uuid, req.params.billId),
    req.user.id,
    res,
  ),
);
export default router;
