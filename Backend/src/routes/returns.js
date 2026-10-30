import { Router } from "express";
import { z } from "zod";
import { owner } from "../auth.js";
import { parse, uuid } from "../utils/validation.js";
import { recordReturn } from "../services/returns.js";
const router = Router({ mergeParams: true });
router.post("/returns", owner, async (req, res) =>
  res.status(201).json(
    await recordReturn(
      req.params.businessId,
      req.user.id,
      parse(
        z
          .object({
            id: uuid,
            billId: uuid,
            lineId: uuid,
            unitId: uuid.optional(),
            quantityMilli: z.number().int().positive().max(100000000),
            disposition: z.enum(["restockable", "damaged", "discarded"]),
            resolution: z.enum(["advance", "refund"]),
            refundId: uuid.optional(),
            refundMethod: z.enum(["cash", "upi", "bank"]).optional(),
            reason: z.string().trim().min(1).max(500),
            operationId: uuid,
          })
          .strict(),
        req.body,
      ),
    ),
  ),
);
export default router;
