import { Router } from "express";
import { z } from "zod";
import { parse, uuid } from "../utils/validation.js";
import {
  beginMfa,
  confirmMfa,
  mfaStatus,
  rotateRecoveryCodes,
  disableMfa,
} from "../services/mfa-management.js";
import {
  listOwnDevices,
  revokeOwnDevice,
  logoutAllDevices,
} from "../services/device-sessions.js";
const router = Router({ mergeParams: true });
const password = z.string().min(1).max(256);
const proof = z
  .object({
    password,
    mfaCode: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    recoveryCode: z
      .string()
      .regex(/^[0-9a-f]{32}$/)
      .optional(),
  })
  .strict()
  .refine((v) => Boolean(v.mfaCode) !== Boolean(v.recoveryCode));
router.get("/me/mfa", async (req, res) =>
  res.json(await mfaStatus(req.user.id)),
);
router.post("/me/mfa/setup", async (req, res) =>
  res.json(
    await beginMfa(
      req.user.id,
      parse(z.object({ password }).strict(), req.body),
    ),
  ),
);
router.post("/me/mfa/confirm", async (req, res) =>
  res.json(
    await confirmMfa(
      req.user.id,
      parse(z.object({ code: z.string().regex(/^\d{6}$/) }).strict(), req.body),
      req.sessionId,
    ),
  ),
);
router.post("/me/mfa/recovery-codes", async (req, res) =>
  res.json(await rotateRecoveryCodes(req.user.id, parse(proof, req.body))),
);
router.post("/me/mfa/disable", async (req, res) =>
  res.json(
    await disableMfa(req.user.id, req.sessionId, parse(proof, req.body)),
  ),
);
router.get("/me/devices", async (req, res) =>
  res.json({ devices: await listOwnDevices(req.user.id, req.sessionId) }),
);
router.delete("/me/devices/:id", async (req, res) =>
  res.json(await revokeOwnDevice(req.user.id, parse(uuid, req.params.id))),
);
router.post("/me/logout-all", async (req, res) => {
  parse(z.object({}).strict(), req.body ?? {});
  res.json(await logoutAllDevices(req.user.id));
});
export default router;
