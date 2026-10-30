import express, { Router } from "express";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { environment } from "../config.js";
import { authenticate, admin } from "../auth.js";
import { parse, uuid } from "../utils/validation.js";
import { rateLimit } from "../utils/rate-limit.js";
import { adminDirectory } from "../services/admin-directory.js";
import {
  createBusiness,
  createUser,
  createMembership,
  deactivateMembership,
  deactivateDevice,
} from "../services/accounts.js";
import { mfaStatus, rotateRecoveryCodes } from "../services/mfa-management.js";
import {
  cookieToken,
  writeBrowserCookie,
  clearBrowserCookie,
  csrfMatches,
  startBrowserSession,
  readBrowserSession,
  endBrowserSession,
} from "../services/admin-browser-sessions.js";
const router = Router(),
  api = Router();
router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
function expectedOrigin(req) {
  const configured = process.env.ADMIN_WEB_ORIGIN;
  if (!configured && environment === "production")
    throw Object.assign(Error("Admin website origin is not configured"), {
      status: 503,
    });
  const value = configured || `${req.protocol}://${req.get("host")}`;
  const url = new URL(value);
  if (
    url.origin !== value ||
    (environment === "production" && url.protocol !== "https:")
  )
    throw Object.assign(Error("Admin website origin is invalid"), {
      status: 503,
    });
  return value;
}
api.use((req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (
    req.get("origin") !== expectedOrigin(req) ||
    req.get("sec-fetch-site") === "cross-site" ||
    req.get("x-requested-with") !== "BillEaseAdmin"
  )
    return res
      .status(403)
      .json({ error: "Same-origin admin request required" });
  if (
    ["POST", "PUT", "PATCH"].includes(req.method) &&
    !req.is("application/json")
  )
    return res.status(415).json({ error: "JSON body required" });
  next();
});
api.post(
  "/login",
  async (req, res, next) => {
    req.url = "/auth/login";
    await rateLimit(true)(req, res, () => {
      req.url = "/login";
      next();
    });
  },
  async (req, res) => {
    const input = parse(
      z
        .object({
          email: z.email(),
          password: z.string().min(1).max(256),
          mfaCode: z
            .string()
            .regex(/^\d{6}$/)
            .optional(),
          recoveryCode: z
            .string()
            .regex(/^[0-9a-f]{32}$/)
            .optional(),
        })
        .strict(),
      req.body,
    );
    const previous = cookieToken(req);
    const session = await startBrowserSession(input);
    if (previous) await endBrowserSession(previous);
    writeBrowserCookie(res, session.token);
    res.json({ user: session.user, csrfToken: session.csrfToken, environment });
  },
);
api.use(async (req, res, next) => {
  const session = await readBrowserSession(cookieToken(req));
  if (!session) {
    clearBrowserCookie(res);
    return res.status(401).json({ error: "Sign in to the admin website" });
  }
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    !csrfMatches(req.get("x-csrf-token"), session.csrf_token)
  )
    return res
      .status(403)
      .json({ error: "Invalid request verification token; reload this page" });
  req.adminSession = session;
  req.headers.authorization = `Bearer ${session.accessToken}`;
  authenticate(req, res, () => admin(req, res, next));
});
api.use(rateLimit());
api.get("/session", (req, res) =>
  res.json({
    user: { id: req.user.id, email: req.user.email, isAdmin: true },
    csrfToken: req.adminSession.csrf_token,
    environment,
  }),
);
api.post("/logout", async (req, res) => {
  parse(z.object({}).strict(), req.body);
  await endBrowserSession(cookieToken(req));
  clearBrowserCookie(res);
  res.json({ loggedOut: true });
});
api.get("/directory", async (_req, res) => res.json(await adminDirectory()));
api.post("/businesses", async (req, res) =>
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
api.post("/users", async (req, res) =>
  res
    .status(201)
    .json(
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
api.post("/memberships", async (req, res) =>
  res
    .status(201)
    .json(
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
api.delete("/businesses/:businessId/memberships/:userId", async (req, res) =>
  res.json(
    await deactivateMembership(
      parse(uuid, req.params.businessId),
      parse(uuid, req.params.userId),
      req.user.id,
    ),
  ),
);
api.delete("/devices/:id", async (req, res) =>
  res.json(await deactivateDevice(parse(uuid, req.params.id), req.user.id)),
);
api.get("/mfa", async (req, res) => res.json(await mfaStatus(req.user.id)));
api.post("/mfa/recovery-codes", async (req, res) =>
  res.json(
    await rotateRecoveryCodes(
      req.user.id,
      parse(
        z
          .object({
            password: z.string().min(1).max(256),
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
          .refine((v) => Boolean(v.mfaCode) !== Boolean(v.recoveryCode)),
        req.body,
      ),
    ),
  ),
);
api.use((_req, res) =>
  res.status(404).json({ error: "Admin endpoint not found" }),
);
router.use("/api", api);
const assets = fileURLToPath(
  new URL("../../../Frontend/Admin/", import.meta.url),
);
router.get("/", (_req, res) => res.sendFile("index.html", { root: assets }));
for (const filename of ["app.js", "model.mjs", "styles.css"])
  router.get(`/${filename}`, (_req, res) => {
    if (filename.endsWith(".mjs")) res.type("application/javascript");
    res.sendFile(filename, { root: assets });
  });
router.use(
  "/assets",
  express.static(`${assets}/assets`, { index: false, dotfiles: "deny" }),
);
export default router;
