const moneyFields = ["taxableMinor", "cgstMinor", "sgstMinor", "igstMinor"];
function invalid() {
  throw Object.assign(new Error("Original tax snapshot is inconsistent"), {
    status: 409,
  });
}
function money(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) invalid();
  return BigInt(value);
}
function roundedShare(amount, numerator, denominator) {
  return denominator === 0n
    ? 0n
    : (amount * numerator * 2n + denominator) / (2n * denominator);
}

// Allocate total tax first so a one-paisa adjustment can never reverse two
// independently rounded taxes. Splitting the cumulative tax between CGST/SGST
// then preserves monotonic allocations, including the final odd paisa.
function cumulativeAllocation(original, gross) {
  const total = money(original.amountMinor);
  const cgst = money(original.cgstMinor),
    sgst = money(original.sgstMinor),
    igst = money(original.igstMinor);
  const tax = cgst + sgst + igst;
  if (
    money(original.taxableMinor) + tax !== total ||
    (igst > 0n && cgst + sgst > 0n) ||
    gross > total
  )
    invalid();
  const taxTarget = roundedShare(tax, gross, total);
  const cgstTarget = roundedShare(cgst, taxTarget, tax);
  return {
    taxableMinor: gross - taxTarget,
    cgstMinor: cgstTarget,
    sgstMinor: igst > 0n ? 0n : taxTarget - cgstTarget,
    igstMinor: igst > 0n ? taxTarget : 0n,
  };
}

export function adjustmentTaxSnapshot({ line, value, previous = [] }) {
  const tax = line.document_snapshot?.tax;
  if (!tax) return null; // Documents predating GST snapshots retain legacy handling.
  const original = tax.lines?.find((entry) => entry.lineId === line.id);
  if (
    !original ||
    money(original.amountMinor) !== BigInt(line.line_total_minor)
  )
    invalid();
  const priorGross = BigInt(line.adjusted_value_minor);
  const gross = priorGross + value;
  if (value < 0n || gross > money(original.amountMinor)) invalid();
  const prior = Object.fromEntries(moneyFields.map((field) => [field, 0n]));
  let savedGross = 0n;
  for (const adjustment of previous) {
    const snapshot = adjustment.tax_snapshot;
    if (!snapshot || snapshot.originalLineId !== line.id) invalid();
    savedGross += money(snapshot.totalMinor);
    for (const field of moneyFields) prior[field] += money(snapshot[field]);
  }
  if (savedGross !== priorGross) invalid();
  const target = cumulativeAllocation(original, gross);
  const components = {};
  for (const field of moneyFields) {
    const delta = target[field] - prior[field];
    if (delta < 0n) invalid();
    components[field] = delta.toString();
  }
  if (
    moneyFields.reduce((sum, field) => sum + BigInt(components[field]), 0n) !==
    value
  )
    invalid();
  return {
    kind: "operational_tax_reversal",
    legalStatus: "unissued",
    originalBillId: line.bill_id,
    originalLineId: line.id,
    originalInvoiceNumber: line.invoice_number,
    originalFinancialYear: line.financial_year,
    mode: tax.mode,
    taxType: tax.taxType,
    placeOfSupply: tax.placeOfSupply,
    stateCode: tax.stateCode,
    hsn: original.hsn,
    taxCategory: original.taxCategory,
    gstRateBps: original.gstRateBps,
    cgstRateBps: original.cgstRateBps,
    sgstRateBps: original.sgstRateBps,
    igstRateBps: original.igstRateBps,
    ...components,
    totalMinor: value.toString(),
    cumulativeGrossMinor: gross.toString(),
  };
}
