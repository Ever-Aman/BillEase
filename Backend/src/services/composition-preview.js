import { PDFDocument } from "pdfkit";
import { pool } from "../config.js";
import { renderInvoiceLayout } from "../utils/invoice-layout.js";
export async function writeCompositionPreview(businessId, input, res) {
  const { rows } = await pool.query(
    "SELECT document_profile FROM businesses WHERE id=$1",
    [businessId],
  );
  const supplier = rows[0]?.document_profile;
  if (!supplier?.gstin || !supplier?.signatory)
    throw Object.assign(
      new Error("Supplier GSTIN and signatory are required for preview"),
      { status: 409 },
    );
  const total = input.lines.reduce(
    (sum, line) => sum + BigInt(line.valueMinor),
    0n,
  );
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="composition-bill-of-supply-draft.pdf"',
  );
  res.setHeader("Cache-Control", "private, no-store");
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  doc.pipe(res);
  renderInvoiceLayout(doc, {
    title: "DRAFT BILL OF SUPPLY",
    number: "DRAFT - no official number",
    date: new Date().toISOString(),
    mode: "composition",
    supplier,
    customer: {
      name: input.recipientName,
      address: input.recipientAddress,
      gstin: input.recipientGstin,
    },
    countryOfSupply: "India",
    lines: input.lines.map((line) => ({
      description: line.description,
      hsn: line.hsn,
      quantity: line.quantity,
      amountMinor: String(line.valueMinor),
    })),
    totalMinor: total.toString(),
    status: "DRAFT - NOT ISSUED",
    notice:
      "Draft only. No official serial number or tax charge. This file is not an issued bill of supply.",
  });
  doc.end();
}
