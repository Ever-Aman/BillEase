import { Router } from "express";
import { z } from "zod";
import { owner } from "../auth.js";
import { parse, uuid } from "../utils/validation.js";
import {
  overview,
  customerHistory,
  fulfilmentRows,
} from "../services/reports.js";
import { gstSummary } from "../services/gst-reports.js";
const router = Router({ mergeParams: true });
router.get("/reports/gst", owner, async (req, res) => {
  const query = parse(
    z
      .object({
        from: z.iso.datetime({ offset: true }),
        to: z.iso.datetime({ offset: true }),
      })
      .strict(),
    req.query,
  );
  res.json(await gstSummary(req.params.businessId, query.from, query.to));
});
router.get("/reports/overview", owner, async (req, res) => {
  const query = parse(
    z.object({
      from: z.iso.datetime({ offset: true }),
      to: z.iso.datetime({ offset: true }),
    }),
    req.query,
  );
  if (new Date(query.from) >= new Date(query.to))
    return res.status(400).json({ error: "Invalid report period" });
  res.json(await overview(req.params.businessId, query.from, query.to));
});
router.get("/reports/fulfilment", owner, async (req, res) =>
  res.json(
    await fulfilmentRows(
      req.params.businessId,
      parse(uuid.nullable(), req.query.after ?? null),
    ),
  ),
);
router.get(
  "/reports/customers/:customerId/history",
  owner,
  async (req, res) => {
    const after = parse(
      z
        .string()
        .regex(/^\d{1,19}$/)
        .refine((v) => BigInt(v) <= 9223372036854775807n),
      req.query.after ?? "0",
    );
    const rows = await customerHistory(
      req.params.businessId,
      parse(uuid, req.params.customerId),
      after,
    );
    const events = rows.slice(0, 500);
    res.json({
      events,
      nextCursor: events.at(-1)?.id ?? after,
      hasMore: rows.length > 500,
    });
  },
);
export default router;
