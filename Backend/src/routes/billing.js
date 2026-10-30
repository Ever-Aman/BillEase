import { Router } from "express";
import { z } from "zod";
import { owner } from "../auth.js";
import { parse, uuid, stateCode } from "../utils/validation.js";
import {
  createBill,
  getBill,
  decidePayment,
  decideCredit,
  customerDebt,
} from "../services/billing.js";
const router = Router({ mergeParams: true });
const positiveAmount = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const line = z
  .object({
    id: uuid,
    itemId: uuid,
    unitId: uuid,
    catalogueVersion: z.number().int().positive(),
    quantityMilli: z.number().int().positive().max(100000000),
    overridePriceMinor: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
  })
  .strict();
const payment = z
  .object({
    id: uuid,
    method: z.enum(["cash", "upi", "bank"]),
    amountMinor: positiveAmount,
  })
  .strict();
const bill = z
  .object({
    id: uuid,
    customerId: uuid.nullable(),
    placeOfSupply: stateCode.optional(),
    quotationId: uuid.optional(),
    occurrenceAt: z.iso.datetime({ offset: true }),
    lines: z.array(line).min(1).max(100),
    payments: z.array(payment).max(20),
    operationId: uuid,
  })
  .strict();
router.post("/bills", async (req, res) => {
  const input = parse(bill, req.body);
  if (
    new Set(input.lines.map((x) => x.id)).size !== input.lines.length ||
    new Set(input.payments.map((x) => x.id)).size !== input.payments.length
  )
    return res.status(400).json({ error: "Duplicate child ID" });
  res
    .status(201)
    .json(
      await createBill(req.params.businessId, req.user.id, req.role, input),
    );
});
router.get("/bills/:billId", async (req, res) => {
  const id = parse(uuid, req.params.billId);
  res.json(await getBill(req.params.businessId, id, req.user.id, req.role));
});
router.post("/payments/:paymentId/decision", owner, async (req, res) => {
  const input = parse(
    z
      .object({ paymentId: uuid, confirm: z.boolean(), operationId: uuid })
      .strict(),
    req.body,
  );
  if (input.paymentId !== req.params.paymentId)
    return res.status(400).json({ error: "Payment ID mismatch" });
  res.json(await decidePayment(req.params.businessId, req.user.id, input));
});
router.post("/bills/:billId/credit-decision", owner, async (req, res) => {
  const input = parse(
    z
      .object({ billId: uuid, approve: z.boolean(), operationId: uuid })
      .strict(),
    req.body,
  );
  if (input.billId !== req.params.billId)
    return res.status(400).json({ error: "Bill ID mismatch" });
  res.json(await decideCredit(req.params.businessId, req.user.id, input));
});
router.get("/customers/:customerId/debt", owner, async (req, res) =>
  res.json(
    await customerDebt(
      req.params.businessId,
      parse(uuid, req.params.customerId),
    ),
  ),
);
export default router;
