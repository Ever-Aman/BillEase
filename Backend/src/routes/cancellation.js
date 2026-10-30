import { Router } from "express";
import { z } from "zod";
import { owner } from "../auth.js";
import { parse, uuid } from "../utils/validation.js";
import { cancelBill } from "../services/cancellation.js";
const router = Router({ mergeParams: true });
router.post("/bills/:billId/cancel", owner, async (req, res) => {
  const input = parse(
    z
      .object({
        billId: uuid,
        lines: z
          .array(
            z
              .object({
                lineId: uuid,
                unitId: uuid.optional(),
                quantityMilli: z.number().int().positive().max(100000000),
              })
              .strict(),
          )
          .min(1)
          .max(100)
          .optional(),
        resolution: z.enum(["advance", "refund"]).optional(),
        refundId: uuid.optional(),
        refundMethod: z.enum(["cash", "upi", "bank"]).optional(),
        reason: z.string().trim().min(1).max(500),
        operationId: uuid,
      })
      .strict(),
    req.body,
  );
  if (input.billId !== req.params.billId)
    return res.status(400).json({ error: "Bill ID mismatch" });
  res.json(await cancelBill(req.params.businessId, req.user.id, input));
});
export default router;
