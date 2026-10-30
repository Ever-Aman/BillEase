import { Router } from "express";
import { z } from "zod";
import { admin } from "../auth.js";
import { parse, uuid } from "../utils/validation.js";
import {
  createBusiness,
  createUser,
  createMembership,
  deactivateMembership,
  deactivateDevice,
} from "../services/accounts.js";
const router = Router({ mergeParams: true });
router.use(admin);
router.post("/businesses", async (req, res) =>
  res
    .status(201)
    .json(
      await createBusiness(
        parse(
          z
            .object({
              id: uuid,
              name: z.string().trim().min(1).max(160),
              documentMode: z.enum(["composition", "regular_gst"]),
            })
            .strict(),
          req.body,
        ),
        req.user.id,
      ),
    ),
);
router.post("/users", async (req, res) =>
  res.status(201).json(
    await createUser(
      parse(
        z
          .object({
            id: uuid,
            email: z.email(),
            password: z.string().min(12).max(256),
          })
          .strict(),
        req.body,
      ),
      req.user.id,
    ),
  ),
);
router.post("/memberships", async (req, res) =>
  res.status(201).json(
    await createMembership(
      parse(
        z
          .object({
            userId: uuid,
            businessId: uuid,
            role: z.enum(["owner", "staff"]),
          })
          .strict(),
        req.body,
      ),
      req.user.id,
    ),
  ),
);
router.delete("/businesses/:businessId/memberships/:userId", async (req, res) =>
  res.json(
    await deactivateMembership(
      parse(uuid, req.params.businessId),
      parse(uuid, req.params.userId),
      req.user.id,
    ),
  ),
);
router.delete("/devices/:deviceId", async (req, res) =>
  res.json(
    await deactivateDevice(parse(uuid, req.params.deviceId), req.user.id),
  ),
);
export default router;
