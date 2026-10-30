import { Router } from "express";
import { z } from "zod";
import { owner } from "../auth.js";
import { parse, uuid } from "../utils/validation.js";
import {
  reconcileQuarantine,
  listQuarantine,
  noteQuarantine,
  decideQuarantine,
} from "../services/quarantine.js";
const router = Router({ mergeParams: true });
router.get("/quarantine", owner, async (req, res) =>
  res.json({ operations: await listQuarantine(req.params.businessId) }),
);
router.post(
  "/quarantine/:deviceId/:operationId/review",
  owner,
  async (req, res) => {
    const input = parse(
      z.object({ note: z.string().trim().min(1).max(500) }).strict(),
      req.body,
    );
    res.json(
      await noteQuarantine(
        req.params.businessId,
        parse(uuid, req.params.deviceId),
        parse(uuid, req.params.operationId),
        req.user.id,
        input.note,
      ),
    );
  },
);
router.post(
  "/quarantine/:deviceId/:operationId/decision",
  owner,
  async (req, res) => {
    const input = parse(
      z
        .object({
          accept: z.boolean(),
          reason: z.string().trim().min(1).max(500),
          decisionOperationId: uuid,
        })
        .strict(),
      req.body,
    );
    res.json(
      await decideQuarantine(
        req.params.businessId,
        parse(uuid, req.params.deviceId),
        parse(uuid, req.params.operationId),
        req.user.id,
        input,
      ),
    );
  },
);
router.post(
  "/quarantine/:deviceId/:operationId/reconcile",
  owner,
  async (req, res) => {
    const input = parse(
      z
        .object({
          resolution: z.enum(["already_applied", "discarded"]),
          note: z.string().trim().min(1).max(500),
          decisionOperationId: uuid,
        })
        .strict(),
      req.body,
    );
    res.json(
      await reconcileQuarantine(
        req.params.businessId,
        parse(uuid, req.params.deviceId),
        parse(uuid, req.params.operationId),
        req.user.id,
        input,
      ),
    );
  },
);
export default router;
