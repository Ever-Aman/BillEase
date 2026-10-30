import { PDFDocument } from "pdfkit";
import { pool } from "../config.js";
import { getBill } from "./billing.js";
import { renderInvoiceLayout } from "../utils/invoice-layout.js";
import { renderLegacyBillLayout } from "../utils/legacy-document-layout.js";
import { gstDocumentModel } from "../utils/gst-document-model.js";

function money(minor) {
  const v = BigInt(minor);
  return `INR ${v / 100n}.${String(v % 100n).padStart(2, "0")}`;
}
function decimalMilli(value) {
  const milli = BigInt(value);
  const whole = milli / 1000n;
  const fraction = String(milli % 1000n)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}
export async function writeBillPdf(
  businessId,
  billId,
  actorId,
  res,
  options = {},
) {
  const { bill, lines, payments } = await getBill(
    businessId,
    billId,
    actorId,
    "owner",
  );
  if (
    (bill.lifecycle !== "issued" && bill.lifecycle !== "cancelled") ||
    (bill.lifecycle === "issued" &&
      (bill.review_state === "credit_pending" ||
        bill.review_state === "disputed"))
  )
    throw Object.assign(new Error("Bill not approved for PDF"), {
      status: 409,
    });
  if (
    bill.lifecycle === "issued" &&
    payments.some((p) => p.state === "pending" && !p.corrected_at) &&
    bill.review_state !== "approved"
  )
    throw Object.assign(
      new Error(
        "Pending digital receipt needs verification or approved credit",
      ),
      { status: 409 },
    );
  if (!bill.document_snapshot)
    throw Object.assign(new Error("Document snapshot missing"), {
      status: 409,
    });
  const layoutRevision = bill.document_snapshot.layoutRevision;
  if (
    layoutRevision != null &&
    layoutRevision !== "non-gst-v1" &&
    layoutRevision !== "reference-invoice-v1"
  )
    throw Object.assign(
      new Error("Unsupported bill document layout revision"),
      {
        status: 409,
      },
    );
  if (options.showPriorDebt && !bill.balance_snapshot)
    throw Object.assign(
      new Error("Previous balance snapshot unavailable for this older bill"),
      { status: 409 },
    );
  const summary = (
    await pool.query(
      `SELECT (SELECT COALESCE(SUM(value_minor),0) FROM returns WHERE business_id=$1 AND bill_id=$2)
      +(SELECT COALESCE(SUM(value_minor),0) FROM line_cancellations WHERE business_id=$1 AND bill_id=$2) adjusted,
      (SELECT COALESCE(-SUM(advance_delta_minor),0) FROM customer_ledger WHERE business_id=$1 AND bill_id=$2 AND advance_delta_minor<0) advance_used,
      (SELECT COALESCE(SUM(amount_minor),0) FROM refunds WHERE business_id=$1 AND bill_id=$2) refunded,
      (SELECT COALESCE(SUM(debt_delta_minor),0) FROM customer_ledger WHERE business_id=$1 AND customer_id=$3) current_debt`,
      [businessId, billId, bill.customer_id],
    )
  ).rows[0];
  const supplier = bill.document_snapshot,
    customer = bill.customer_snapshot;
  const view = gstDocumentModel(
    supplier,
    lines.map((line) => ({
      id: line.id,
      description: `${line.item_name} / ${line.unit_label}`,
      hsn: line.hsn,
      quantity: decimalMilli(line.quantity_milli),
      unitLabel: line.unit_label,
      unitPriceMinor: line.unit_price_minor,
      amountMinor: line.line_total_minor,
    })),
  );
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="BillEase-${bill.financial_year}-${bill.invoice_number}.pdf"`,
  );
  res.setHeader("Cache-Control", "private, no-store");
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  doc.pipe(res);
  if (layoutRevision !== "reference-invoice-v1") {
    renderLegacyBillLayout(doc, { bill, lines, payments, summary, options });
    doc.end();
    return;
  }
  const extraSections = [
    { lines: [`Current sale: ${money(bill.total_minor)}`] },
  ];
  if (BigInt(summary.adjusted) > 0n)
    extraSections.push({
      lines: [
        `Returns and cancellations: ${money(summary.adjusted)}`,
        `Adjusted sale: ${money(BigInt(bill.total_minor) - BigInt(summary.adjusted))}`,
      ],
    });
  if (options.showPayments) {
    extraSections.push({
      title: "Payment details",
      lines: [
        ...payments
          .filter((p) => !p.corrected_at)
          .map(
            (payment) =>
              `${payment.method}: ${money(payment.amount_minor)} (${payment.state})`,
          ),
        `Existing advance used: ${money(summary.advance_used)}`,
        `Refunds recorded: ${money(summary.refunded)}`,
      ],
    });
  }
  if (options.showPriorDebt && bill.customer_id) {
    extraSections.push({
      lines: [
        `Previous debt at issuance: ${money(bill.balance_snapshot.previousDebtMinor)}`,
        `Previous advance at issuance: ${money(bill.balance_snapshot.previousAdvanceMinor)}`,
        `Current overall customer debt: ${money(summary.current_debt)}`,
        `Balance checked: ${new Date().toISOString()}`,
      ],
    });
  }
  renderInvoiceLayout(doc, {
    ...view,
    number: `${bill.financial_year}/${bill.invoice_number}`,
    date: new Date(bill.issued_at).toISOString(),
    supplier: { ...supplier, name: supplier.name, address: supplier.address },
    customer: customer
      ? {
          ...customer,
          address: customer.address || customer.locality,
          name: customer.name,
        }
      : { name: "Walk-in", address: "" },
    totalMinor: bill.total_minor,
    status:
      bill.lifecycle === "cancelled" ? "CANCELLED - ORIGINAL COPY" : "ISSUED",
    extraSections,
    layoutRevision: bill.document_snapshot.layoutRevision,
  });
  doc.end();
}

export async function writeBillAdjustmentsPdf(
  businessId,
  billId,
  actorId,
  res,
) {
  const { bill, lines } = await getBill(businessId, billId, actorId, "owner");
  if (!bill.document_snapshot)
    throw Object.assign(new Error("Document snapshot missing"), {
      status: 409,
    });
  const [returns, refunds, corrections, cancellations] = await Promise.all([
    pool.query(
      "SELECT r.id,r.line_id,r.quantity_milli,r.value_minor::text,r.disposition,r.reason,r.created_at,l.item_name,r.unit_label,r.tax_snapshot FROM returns r JOIN bill_lines l ON l.business_id=r.business_id AND l.id=r.line_id WHERE r.business_id=$1 AND r.bill_id=$2 ORDER BY r.created_at,r.id",
      [businessId, billId],
    ),
    pool.query(
      "SELECT id,amount_minor::text,method,reason,created_at FROM refunds WHERE business_id=$1 AND bill_id=$2 ORDER BY created_at,id",
      [businessId, billId],
    ),
    pool.query(
      "SELECT c.id,c.payment_id,c.replacement_payment_id,c.reason,c.created_at FROM payment_corrections c JOIN payments p ON p.business_id=c.business_id AND p.id=c.payment_id WHERE c.business_id=$1 AND p.bill_id=$2 ORDER BY c.created_at,c.id",
      [businessId, billId],
    ),
    pool.query(
      "SELECT id,quantity_milli,unit_label,value_minor::text,reason,created_at,tax_snapshot FROM line_cancellations WHERE business_id=$1 AND bill_id=$2 ORDER BY created_at,id",
      [businessId, billId],
    ),
  ]);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="BillEase-${bill.financial_year}-${bill.invoice_number}-history.pdf"`,
  );
  res.setHeader("Cache-Control", "private, no-store");
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  doc.pipe(res);
  doc.fontSize(18).text("BILL ADJUSTMENT HISTORY").moveDown(0.3);
  doc
    .fontSize(10)
    .text(`Supplier: ${bill.document_snapshot.name}`)
    .text(`Original bill: ${bill.financial_year}/${bill.invoice_number}`)
    .text(`Issued: ${new Date(bill.issued_at).toISOString()}`)
    .text(`Current status: ${bill.lifecycle.toUpperCase()}`)
    .text(`Original amount: ${money(bill.total_minor)}`)
    .moveDown();
  doc.fontSize(12).text("Original lines");
  for (const line of lines)
    doc
      .fontSize(10)
      .text(
        `${line.item_name} / ${line.unit_label}: ${Number(line.quantity_milli) / 1000} at ${money(line.unit_price_minor)} = ${money(line.line_total_minor)}`,
      );
  doc.moveDown().fontSize(12).text("Recorded adjustments");
  if (
    !returns.rowCount &&
    !refunds.rowCount &&
    !corrections.rowCount &&
    !cancellations.rowCount
  )
    doc.fontSize(10).text("None recorded.");
  const showTaxReversal = (tax) => {
    if (!tax) return;
    doc
      .fontSize(9)
      .text(
        `Tax reversal | Original ${tax.originalFinancialYear}/${tax.originalInvoiceNumber} | Taxable ${money(tax.taxableMinor)} | CGST ${money(tax.cgstMinor)} | SGST ${money(tax.sgstMinor)} | IGST ${money(tax.igstMinor)}`,
      );
  };
  for (const row of returns.rows) {
    doc
      .fontSize(10)
      .text(
        `Return ${row.id} | ${new Date(row.created_at).toISOString()} | ${row.item_name} / ${row.unit_label} | ${Number(row.quantity_milli) / 1000} | ${money(row.value_minor)} | ${row.disposition} | ${row.reason}`,
      );
    showTaxReversal(row.tax_snapshot);
  }
  for (const row of refunds.rows)
    doc
      .fontSize(10)
      .text(
        `Refund ${row.id} | ${new Date(row.created_at).toISOString()} | ${money(row.amount_minor)} by ${row.method} | ${row.reason}`,
      );
  for (const row of corrections.rows)
    doc
      .fontSize(10)
      .text(
        `Payment correction ${row.id} | ${new Date(row.created_at).toISOString()} | original ${row.payment_id} | replacement ${row.replacement_payment_id || "none"} | ${row.reason}`,
      );
  for (const row of cancellations.rows) {
    doc
      .fontSize(10)
      .text(
        `Cancellation ${row.id} | ${new Date(row.created_at).toISOString()} | ${Number(row.quantity_milli) / 1000} ${row.unit_label} | ${money(row.value_minor)} | ${row.reason}`,
      );
    showTaxReversal(row.tax_snapshot);
  }
  doc
    .moveDown()
    .fontSize(9)
    .text(
      "This history accompanies the preserved original bill. It is not a GST credit note or tax invoice.",
    );
  doc.end();
}
