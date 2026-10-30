import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../auth.js";
import { parse } from "../utils/validation.js";
import {
  login,
  refreshSession,
  logoutSession,
  businessesForUser,
} from "../services/accounts.js";
const router = Router({ mergeParams: true });
router.get("/me", authenticate, (req, res) =>
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      isAdmin: req.user.is_admin,
    },
  }),
);
router.post("/auth/login", async (req, res) => {
  const input = parse(
    z
      .object({
        email: z.email(),
        password: z.string().min(1).max(256),
        deviceId: z.uuid(),
        deviceName: z.string().trim().min(1).max(80),
        devicePublicKey: z.string().min(40).max(128),
        mfaCode: z
          .string()
          .regex(/^\d{6}$/)
          .optional(),
        recoveryCode: z
          .string()
          .regex(/^[0-9a-f]{32}$/i)
          .optional(),
      })
      .strict(),
    req.body,
  );
  res.json(
    await login(
      input.email,
      input.password,
      input.deviceId,
      input.deviceName,
      input.mfaCode,
      input.recoveryCode,
      input.devicePublicKey,
    ),
  );
});
router.post("/auth/refresh", async (req, res) => {
  const input = parse(
    z.object({ refreshToken: z.string().min(40).max(200) }).strict(),
    req.body,
  );
  res.json(await refreshSession(input.refreshToken));
});
router.post("/auth/logout", async (req, res) => {
  const input = parse(
    z.object({ refreshToken: z.string().min(40).max(200) }).strict(),
    req.body,
  );
  res.json(await logoutSession(input.refreshToken));
});
router.get("/me/businesses", authenticate, async (req, res) =>
  res.json({ businesses: await businessesForUser(req.user.id) }),
);
export default router;
