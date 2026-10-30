import { Router } from "express";
import { z } from "zod";
import { owner } from "../auth.js";
import { parse, uuid } from "../utils/validation.js";
import {
  createRequest,
  listRequests,
  decideRequest,
} from "../services/requests.js";
import { listAccessNotices } from "../services/access-notices.js";
const router = Router({ mergeParams: true });
router.get("/requests", async (req, res) =>
  res.json({
    requests: await listRequests(req.params.businessId, req.user.id, req.role),
    ...(req.role === "owner" ? { accessNotices: await listAccessNotices(req.params.businessId) } : {}),
  }),
);
router.post("/requests", async (req, res) => {
  if (req.role !== "staff")
    return res.status(403).json({ error: "Staff request required" });
  return res.status(201).json(
    await createRequest(
      req.params.businessId,
      req.user.id,
      parse(
        z
          .object({
            id: uuid,
            type: z.enum(["bill_cancel", "return", "delivery_correct"]),
            targetId: uuid,
            payload: z.record(z.string(), z.unknown()),
            reason: z.string().trim().min(1).max(500),
            operationId: uuid,
          })
          .strict(),
        req.body,
      ),
    ),
  );
});
router.post("/requests/:id/decision", owner, async (req, res) => {
  const input = parse(
    z
      .object({
        id: uuid,
        approve: z.boolean(),
        reason: z.string().trim().min(1).max(500),
        action: z.record(z.string(), z.unknown()).optional(),
        operationId: uuid,
      })
      .strict(),
    req.body,
  );
  if (input.id !== req.params.id)
    return res.status(400).json({ error: "Request ID mismatch" });
  res.json(await decideRequest(req.params.businessId, req.user.id, input));
});
export default router;
