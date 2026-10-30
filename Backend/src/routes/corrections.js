import { Router } from "express";
import { z } from "zod";
import { owner } from "../auth.js";
import { parse, uuid } from "../utils/validation.js";
import { correctPayment, correctDelivery } from "../services/corrections.js";
const router = Router({ mergeParams: true });
const base = {
  id: uuid,
  reason: z.string().trim().min(1).max(500),
  operationId: uuid,
};
router.post("/payment-corrections", owner, async (req, res) =>
  res.status(201).json(
    await correctPayment(
      req.params.businessId,
      req.user.id,
      parse(
        z
          .object({
            ...base,
            paymentId: uuid,
            replacement: z
              .object({
                id: uuid,
                method: z.enum(["cash", "upi", "bank"]),
                amountMinor: z
                  .number()
                  .int()
                  .positive()
                  .max(Number.MAX_SAFE_INTEGER),
                occurrenceAt: z.iso.datetime(),
              })
              .strict()
              .optional(),
          })
          .strict(),
        req.body,
      ),
    ),
  ),
);
router.post("/delivery-corrections", owner, async (req, res) =>
  res
    .status(201)
    .json(
      await correctDelivery(
        req.params.businessId,
        req.user.id,
        parse(z.object({ ...base, deliveryId: uuid }).strict(), req.body),
      ),
    ),
);
export default router;
