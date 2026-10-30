import { Router } from "express";
import { z } from "zod";
import { parse, uuid } from "../utils/validation.js";
import { uploadRevokedWork } from "../services/quarantine.js";
const router = Router({ mergeParams: true });
router.post("/recovery/upload", async (req, res) =>
  res.status(202).json(
    await uploadRevokedWork(
      parse(
        z
          .object({
            deviceId: uuid,
            businessId: uuid,
            operationId: uuid,
            payloadType: z.enum([
              "customer",
              "online_action",
              "bill",
              "payment",
              "delivery",
              "return",
              "request",
            ]),
            dependencies: z.array(uuid).max(100).optional(),
            originalRole: z.enum(["owner", "staff"]).optional(),
            payload: z.record(z.string(), z.unknown()),
            signature: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
          })
          .strict(),
        req.body,
      ),
    ),
  ),
);
export default router;
