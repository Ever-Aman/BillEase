import { Router } from "express";
import { z } from "zod";
import { owner } from "../auth.js";
import { parse, uuid } from "../utils/validation.js";
import {
  getBalance,
  openingBalance,
  recordRepayment,
  applyAdvance,
} from "../services/finance.js";
import { correctLedgerEntry } from "../services/ledger-corrections.js";
const router = Router({ mergeParams: true });
const base = {
  customerId: uuid,
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  operationId: uuid,
};
router.get("/customers/:customerId/balance", owner, async (req, res) =>
  res.json(
    await getBalance(req.params.businessId, parse(uuid, req.params.customerId)),
  ),
);
router.post("/opening-balances", owner, async (req, res) =>
  res.status(201).json(
    await openingBalance(
      req.params.businessId,
      req.user.id,
      parse(
        z
          .object({
            ...base,
            kind: z.enum(["debt", "advance"]),
            occurrenceAt: z.iso.datetime({ offset: true }).optional(),
            note: z.string().trim().min(1).max(500),
          })
          .strict(),
        req.body,
      ),
    ),
  ),
);
router.post("/repayments", owner, async (req, res) =>
  res.status(201).json(
    await recordRepayment(
      req.params.businessId,
      req.user.id,
      parse(
        z
          .object({
            ...base,
            note: z.string().trim().min(1).max(500),
            occurrenceAt: z.iso.datetime({ offset: true }).optional(),
          })
          .strict(),
        req.body,
      ),
    ),
  ),
);
router.post("/advance-applications", owner, async (req, res) =>
  res
    .status(201)
    .json(
      await applyAdvance(
        req.params.businessId,
        req.user.id,
        parse(z.object({ ...base, billId: uuid }).strict(), req.body),
      ),
    ),
);
router.post("/ledger-corrections", owner, async (req, res) =>
  res.status(201).json(
    await correctLedgerEntry(
      req.params.businessId,
      req.user.id,
      parse(
        z
          .object({
            entryId: z
              .string()
              .regex(/^[1-9]\d{0,18}$/)
              .refine((v) => BigInt(v) <= 9223372036854775807n),
            reason: z.string().trim().min(1).max(500),
            operationId: uuid,
            replacement: z
              .object({
                amountMinor: z
                  .number()
                  .int()
                  .positive()
                  .max(Number.MAX_SAFE_INTEGER),
                openingKind: z.enum(["debt", "advance"]).optional(),
                occurrenceAt: z.iso.datetime({ offset: true }).optional(),
              })
              .strict()
              .optional(),
          })
          .strict(),
        req.body,
      ),
    ),
  ),
);
export default router;
