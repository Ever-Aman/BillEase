import express, { Router } from "express";
import { owner } from "../auth.js";
import {
  template,
  previewCatalogueCsv,
  importCatalogueCsv,
  catalogueImportStatus,
} from "../services/catalogue-csv.js";
const router = Router({ mergeParams: true });
router.get("/catalogue/import-template", owner, (_req, res) => {
  res.type("text/csv").send(template);
});
const csvBody = express.text({ type: "text/csv", limit: "256kb" });
router.post("/catalogue/import-preview", owner, csvBody, (req, res) =>
  res.json(previewCatalogueCsv(req.body ?? "")),
);
router.post("/catalogue/import-status", owner, csvBody, async (req, res) =>
  res.json(
    await catalogueImportStatus(
      req.params.businessId,
      req.user.id,
      req.body ?? "",
    ),
  ),
);
router.post("/catalogue/import", owner, csvBody, async (req, res) =>
  res.json(
    await importCatalogueCsv(
      req.params.businessId,
      req.user.id,
      req.body ?? "",
    ),
  ),
);
export default router;
