import { Router } from "express";
import { z } from "zod";
import { parse, uuid, stateCode, gstin } from "../utils/validation.js";
import { listCustomers, upsertCustomer } from "../services/customers.js";

const router = Router({ mergeParams: true });
const inputSchema = z
  .object({
    id: uuid,
    name: z.string().trim().min(1).max(160),
    phone: z.string().trim().min(5).max(30),
    gstin: gstin.optional(),
    address: z.string().trim().min(1).max(500).optional(),
    stateCode: stateCode.optional(),
    locality: z.string().trim().min(1).max(160),
    expectedVersion: z.number().int().positive().nullable().default(null),
    active: z.boolean().default(true),
    operationId: uuid,
  })
  .strict();
router.get("/customers", async (req, res) =>
  res.json({
    customers: await listCustomers(
      req.params.businessId,
      req.query.search?.toString().slice(0, 80),
    ),
  }),
);
router.put("/customers/:customerId", async (req, res) => {
  const input = parse(inputSchema, req.body);
  if (input.id !== req.params.customerId)
    return res.status(400).json({ error: "Customer ID mismatch" });
  res.json(await upsertCustomer(req.params.businessId, req.user.id, input));
});
export default router;
