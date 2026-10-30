/** Draw the original snapshot layouts for documents issued before the reference layout. */
export function renderLegacyBillLayout(
  doc,
  { bill, lines, payments, summary, options },
) {
  const supplier = bill.document_snapshot;
  const customer = bill.customer_snapshot;
  doc
    .fontSize(20)
    .text(supplier.name)
    .moveDown(0.2)
    .fontSize(10)
    .text(supplier.address)
    .text(`Phone: ${supplier.phone}`)
    .moveDown();
  doc
    .fontSize(16)
    .text("BILL")
    .fontSize(10)
    .text(
      bill.lifecycle === "cancelled"
        ? "STATUS: CANCELLED - ORIGINAL COPY"
        : "STATUS: ISSUED",
    )
    .fontSize(10)
    .text(`Invoice: ${bill.financial_year}/${bill.invoice_number}`)
    .text(`Issued: ${new Date(bill.issued_at).toISOString()}`)
    .moveDown();
  doc
    .text(
      customer
        ? `Customer: ${customer.name}, ${customer.locality} | ${customer.phone}`
        : "Customer: Walk-in",
    )
    .moveDown();
  const tableHeader = () => {
    const y = doc.y;
    doc.fontSize(10).text("Item / Unit", 40, y, { width: 235 });
    doc.text("Quantity", 275, y, { width: 60, align: "right" });
    doc.text("Rate", 335, y, { width: 100, align: "right" });
    doc.text("Amount", 435, y, { width: 120, align: "right" });
    doc.y = y + 22;
  };
  tableHeader();
  for (const line of lines) {
    if (doc.y > 715) {
      doc.addPage();
      tableHeader();
    }
    const y = doc.y;
    doc.fontSize(10);
    const label = `${line.item_name} / ${line.unit_label}`;
    const height = Math.max(22, doc.heightOfString(label, { width: 225 }) + 8);
    doc.text(label, 40, y, { width: 225 });
    doc.text(decimalMilli(line.quantity_milli), 275, y, {
      width: 60,
      align: "right",
    });
    doc.text(money(line.unit_price_minor), 335, y, {
      width: 100,
      align: "right",
    });
    doc.text(money(line.line_total_minor), 435, y, {
      width: 120,
      align: "right",
    });
    doc.x = 40;
    doc.y = y + height;
  }
  doc
    .moveDown()
    .fontSize(13)
    .text(`Current sale: ${money(bill.total_minor)}`, { align: "right" });
  if (BigInt(summary.adjusted) > 0n)
    doc
      .fontSize(10)
      .text(`Returns and cancellations: ${money(summary.adjusted)}`, {
        align: "right",
      })
      .text(
        `Adjusted sale: ${money(BigInt(bill.total_minor) - BigInt(summary.adjusted))}`,
        { align: "right" },
      );
  if (options.showPayments) {
    doc.moveDown().fontSize(11).text("Payment details");
    for (const payment of payments.filter((p) => !p.corrected_at))
      doc
        .fontSize(10)
        .text(
          `${payment.method}: ${money(payment.amount_minor)} (${payment.state})`,
        );
    doc
      .fontSize(10)
      .text(`Existing advance used: ${money(summary.advance_used)}`)
      .text(`Refunds recorded: ${money(summary.refunded)}`);
  }
  if (options.showPriorDebt && bill.customer_id) {
    doc
      .moveDown()
      .fontSize(10)
      .text(
        `Previous debt at issuance: ${money(bill.balance_snapshot.previousDebtMinor)}`,
      )
      .text(
        `Previous advance at issuance: ${money(bill.balance_snapshot.previousAdvanceMinor)}`,
      )
      .text(`Current overall customer debt: ${money(summary.current_debt)}`)
      .fontSize(8)
      .text(`Balance checked: ${new Date().toISOString()}`);
  }
  doc
    .moveDown()
    .fontSize(8)
    .text(`Layout: ${bill.document_snapshot.layoutRevision ?? "legacy"}`);
}

export function renderLegacyQuotationLayout(doc, { quotation, lines }) {
  const supplier = quotation.document_snapshot;
  const customer = quotation.customer_snapshot;
  doc
    .fontSize(20)
    .text(supplier.name)
    .fontSize(10)
    .text(supplier.address)
    .text(`Phone: ${supplier.phone}`)
    .moveDown();
  doc
    .fontSize(17)
    .text("QUOTATION")
    .fontSize(10)
    .text(`Reference: ${quotation.reference}`)
    .text(`Created: ${new Date(quotation.created_at).toISOString()}`)
    .moveDown();
  doc
    .text(
      customer
        ? `Customer: ${customer.name}, ${customer.locality} | ${customer.phone}`
        : "Customer: Walk-in",
    )
    .moveDown();
  for (const line of lines) {
    if (doc.y > 710) doc.addPage();
    doc
      .fontSize(10)
      .text(`${line.item_name} / ${line.unit_label}`)
      .text(
        `Quantity: ${decimalMilli(line.quantity_milli)} | Rate: ${money(line.price_minor)} | Amount: ${money(line.line_total_minor)}`,
      )
      .moveDown(0.5);
  }
  doc
    .moveDown()
    .fontSize(13)
    .text(`Quotation total: ${money(quotation.total_minor)}`, {
      align: "right",
    });
  doc
    .moveDown()
    .fontSize(9)
    .text(
      "Quotation only. An issued bill is created separately after confirmation.",
    );
}

function money(minor) {
  const value = BigInt(minor);
  return `INR ${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}

function decimalMilli(value) {
  const milli = BigInt(value);
  const whole = milli / 1000n;
  const fraction = String(milli % 1000n)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}
