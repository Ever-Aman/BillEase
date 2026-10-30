import { Router } from "express";
import { owner } from "../auth.js";
import { parse, itemInput } from "../utils/validation.js";
import {
  listCatalogue,
  pullChanges,
  upsertItem,
} from "../services/catalogue.js";
import { z } from "zod";
const router = Router({ mergeParams: true });
router.get("/catalogue", async (req, res) =>
  res.json({ items: await listCatalogue(req.params.businessId) }),
);
router.get("/sync", async (req, res) =>
  res.json(
    await pullChanges(
      req.params.businessId,
      parse(z.coerce.number().int().min(0), req.query.cursor ?? 0),
      req.user.id,
      req.role,
    ),
  ),
);
router.put("/catalogue/items/:itemId", owner, async (req, res) => {
  const input = parse(itemInput, req.body);
  res.json(
    await upsertItem(
      req.params.businessId,
      req.params.itemId,
      req.user.id,
      input,
    ),
  );
});
export default router;
