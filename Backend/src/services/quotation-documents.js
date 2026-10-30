import { PDFDocument } from "pdfkit";
import { getQuotation } from "./quotations.js";
import { renderInvoiceLayout } from "../utils/invoice-layout.js";
import { renderLegacyQuotationLayout } from "../utils/legacy-document-layout.js";
import { gstDocumentModel } from "../utils/gst-document-model.js";

function money(value) {
  const n = BigInt(value);
  return `INR ${n / 100n}.${String(n % 100n).padStart(2, "0")}`;
}
function decimalMilli(value) {
  const milli = BigInt(value);
  const whole = milli / 1000n;
  const fraction = String(milli % 1000n)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}
export async function writeQuotationPdf(businessId, quotationId, res) {
  const { quotation, lines } = await getQuotation(businessId, quotationId);
  const supplier = quotation.document_snapshot,
    customer = quotation.customer_snapshot;
  if (!supplier)
    throw Object.assign(new Error("Quotation document snapshot unavailable"), {
      status: 409,
    });
  const layoutRevision = supplier.layoutRevision;
  if (
    layoutRevision != null &&
    layoutRevision !== "quotation-v1" &&
    layoutRevision !== "reference-quotation-v1"
  )
    throw Object.assign(
      new Error("Unsupported quotation document layout revision"),
      { status: 409 },
    );
  const view = gstDocumentModel(
    supplier,
    lines.map((line) => ({
      id: line.id,
      description: `${line.item_name} / ${line.unit_label}`,
      hsn: line.hsn,
      quantity: decimalMilli(line.quantity_milli),
      unitLabel: line.unit_label,
      unitPriceMinor: line.price_minor,
      amountMinor: line.line_total_minor,
    })),
    { quotation: true },
  );
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="BillEase-quotation-${quotation.id}.pdf"`,
  );
  res.setHeader("Cache-Control", "private, no-store");
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  doc.pipe(res);
  if (layoutRevision !== "reference-quotation-v1") {
    renderLegacyQuotationLayout(doc, { quotation, lines });
    doc.end();
    return;
  }
  renderInvoiceLayout(doc, {
    ...view,
    number: quotation.reference,
    date: new Date(quotation.created_at).toISOString(),
    supplier,
    customer: customer
      ? { ...customer, address: customer.address || customer.locality }
      : { name: "Walk-in", address: "" },
    totalMinor: quotation.total_minor,
    notice:
      "Quotation only. An issued bill is created separately after confirmation.",
    extraSections: [
      { lines: [`Quotation total: ${money(quotation.total_minor)}`] },
    ],
    layoutRevision: quotation.document_snapshot.layoutRevision,
  });
  doc.end();
}
