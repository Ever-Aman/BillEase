import express from "express";
import helmet from "helmet";
import { pool, environment, trustProxyHops } from "./config.js";
import { authenticate, membership } from "./auth.js";
import { uuid } from "./utils/validation.js";
import { errorHandler } from "./utils/errors.js";
import authRoutes from "./routes/auth.js";
import adminBrowserRoutes from "./routes/admin-browser.js";
import adminRoutes from "./routes/admin.js";
import catalogueRoutes from "./routes/catalogue.js";
import customerRoutes from "./routes/customers.js";
import billingRoutes from "./routes/billing.js";
import settingsRoutes from "./routes/settings.js";
import financeRoutes from "./routes/finance.js";
import deliveryRoutes from "./routes/delivery.js";
import documentRoutes from "./routes/documents.js";
import returnRoutes from "./routes/returns.js";
import correctionRoutes from "./routes/corrections.js";
import reportRoutes from "./routes/reports.js";
import quotationRoutes from "./routes/quotations.js";
import cancellationRoutes from "./routes/cancellation.js";
import catalogueCsvRoutes from "./routes/catalogue-csv.js";
import compositionPreviewRoutes from "./routes/composition-preview.js";
import recoveryUploadRoutes from "./routes/recovery-upload.js";
import quarantineRoutes from "./routes/quarantine.js";
import requestRoutes from "./routes/requests.js";
import pushRoutes from "./routes/push.js";
import conflictRoutes from "./routes/conflicts.js";
import securityRoutes from "./routes/security.js";
import { guardConflictOperation } from "./services/conflicts.js";
import { rateLimit } from "./utils/rate-limit.js";
const app = express();
app.set("trust proxy", trustProxyHops);
app.disable("x-powered-by");
app.use(helmet({contentSecurityPolicy:{directives:{'upgrade-insecure-requests': environment === 'production' ? [] : null}}}));
app.get('/',(_req,res)=>res.redirect(303,'/admin/'));
app.use(express.json({ limit: "128kb" }));
app.get("/health", async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ status: "ok", environment });
});
app.use("/admin", adminBrowserRoutes);
app.use("/v1", rateLimit(true));
app.use("/v1", (_req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
});
app.use("/v1", authRoutes);
app.use("/v1", recoveryUploadRoutes);
app.use("/v1", authenticate);
app.use("/v1", rateLimit());
app.use("/v1", pushRoutes);
app.use("/v1", securityRoutes);
app.use("/v1/admin", adminRoutes);
app.use(
  "/v1/businesses/:businessId",
  (req, res, next) => {
    if (!uuid.safeParse(req.params.businessId).success)
      return res.status(400).json({ error: "Invalid business ID" });
    next();
  },
  membership,
  guardConflictOperation,
  catalogueRoutes,
  customerRoutes,
  billingRoutes,
  settingsRoutes,
  financeRoutes,
  deliveryRoutes,
  documentRoutes,
  returnRoutes,
  correctionRoutes,
  reportRoutes,
  quotationRoutes,
  cancellationRoutes,
  catalogueCsvRoutes,
  compositionPreviewRoutes,
  quarantineRoutes,
  requestRoutes,
  conflictRoutes,
);
app.use((_req, res) => res.status(404).json({ error: "Endpoint not found" }));
app.use(errorHandler);
export default app;
