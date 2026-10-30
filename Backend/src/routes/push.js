import { Router } from "express";
import { z } from "zod";
import { parse, uuid } from "../utils/validation.js";
import { savePushToken, removePushToken } from "../services/push.js";
const router = Router({ mergeParams: true });
router.put("/devices/:deviceId/push-token", async (req, res) =>
  res.json(
    await savePushToken(
      parse(uuid, req.params.deviceId),
      req.user.id,
      req.sessionId,
      parse(
        z.object({ token: z.string().min(20).max(4096) }).strict(),
        req.body,
      ).token,
    ),
  ),
);
router.delete("/devices/:deviceId/push-token", async (req, res) =>
  res.json(
    await removePushToken(
      parse(uuid, req.params.deviceId),
      req.user.id,
      req.sessionId,
    ),
  ),
);
export default router;
