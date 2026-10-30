import { Router } from "express";
import { z } from "zod";
import { owner } from "../auth.js";
import { parse, uuid } from "../utils/validation.js";
import {
  deliveryView,
  recordDelivery,
  reviewDelivery,
} from "../services/delivery.js";
const router = Router({ mergeParams: true });
router.get("/delivery/:billId", async (req, res) =>
  res.json(
    await deliveryView(req.params.businessId, parse(uuid, req.params.billId)),
  ),
);
router.post("/delivery", async (req, res) =>
  res.status(201).json(
    await recordDelivery(
      req.params.businessId,
      req.user.id,
      req.role,
      parse(
        z
          .object({
            id: uuid,
            billId: uuid,
            lineId: uuid,
            unitId: uuid,
            quantityMilli: z.number().int().positive().max(100000000),
            occurrenceAt: z.iso.datetime({ offset: true }),
            operationId: uuid,
            authorizationRevision: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .optional(),
          })
          .strict(),
        req.body,
      ),
    ),
  ),
);
router.post("/delivery/:id/review", owner, async (req, res) => {
  const input = parse(
    z.object({ id: uuid, accept: z.boolean(), operationId: uuid }).strict(),
    req.body,
  );
  if (input.id !== req.params.id)
    return res.status(400).json({ error: "Delivery ID mismatch" });
  res.json(await reviewDelivery(req.params.businessId, req.user.id, input));
});
export default router;
