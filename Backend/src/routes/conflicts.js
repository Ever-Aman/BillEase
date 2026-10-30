import { Router } from "express";
import { z } from "zod";
import { owner } from "../auth.js";
import { parse, uuid } from "../utils/validation.js";
import {
  listSyncConflicts,
  resolveSyncConflict,
} from "../services/conflicts.js";
const router = Router({ mergeParams: true });
router.get("/conflicts", owner, async (req, res) =>
  res.json({ conflicts: await listSyncConflicts(req.params.businessId) }),
);
router.post("/conflicts/:id/resolve", owner, async (req, res) => {
  const input = parse(
    z
      .object({
        resolution: z.enum(["discarded", "superseded", "retry_after_sync"]),
        replacementOperationId: uuid.optional(),
        note: z.string().trim().min(1).max(500),
        operationId: uuid,
      })
      .strict(),
    req.body,
  );
  res.json(
    await resolveSyncConflict(req.params.businessId, req.user.id, {
      ...input,
      id: parse(uuid, req.params.id),
    }),
  );
});
export default router;
