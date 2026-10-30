// Tax extraction follows CGST Rules, rule 35: inclusive value × rate / (100 + rate).
// Sources: https://taxinformation.cbic.gov.in/content-page/explore-rules/1000136/1000001 (rule 46)
// https://cbic-gst.gov.in/pdf/03042020-CGST-Rules-2017-Part-A-Rules.pdf (rules 35, 46, 46A, 49).
// Monetary arithmetic is integer paise. Round once per line; an odd tax paise goes to CGST.
export const STATE_CODES = new Set([
  "01",
  "02",
  "03",
  "04",
  "05",
  "06",
  "07",
  "08",
  "09",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "20",
  "21",
  "22",
  "23",
  "24",
  "26",
  "27",
  "29",
  "30",
  "31",
  "32",
  "33",
  "34",
  "35",
  "36",
  "37",
  "38",
]);
const UTGST_CODES = new Set(["04", "26", "31", "35", "38"]);
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const fail = (message) => {
  throw Object.assign(new Error(message), { status: 400 });
};
export function validGstin(value) {
  if (!GSTIN_PATTERN.test(value ?? "") || !STATE_CODES.has(value.slice(0, 2)))
    return false;
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let sum = 0,
    factor = 2;
  for (let i = 13; i >= 0; i--) {
    const product = alphabet.indexOf(value[i]) * factor;
    sum += Math.floor(product / 36) + (product % 36);
    factor = factor === 2 ? 1 : 2;
  }
  return alphabet[(36 - (sum % 36)) % 36] === value[14];
}
export function validateParty(party, { supplier = false } = {}) {
  if (party?.stateCode != null && !STATE_CODES.has(party.stateCode))
    fail("Invalid Indian state code");
  if (party?.gstin && !validGstin(party.gstin))
    fail("Invalid GSTIN including check digit");
  if (
    party?.gstin &&
    party.stateCode &&
    party.gstin.slice(0, 2) !== party.stateCode
  )
    fail("GSTIN must match state code");
  if (
    supplier &&
    (!party?.name ||
      !party.address ||
      !party.signatory ||
      !party.gstin ||
      !party.stateCode)
  )
    fail(
      "GST supplier name, address, GSTIN, state code and signatory required",
    );
}
export function validateItemTax(item) {
  if (!/^\d{4,8}$/.test(item.hsn ?? ""))
    fail("Valid HSN required for GST documents");
  if (
    !["taxable", "nil_rated", "exempt"].includes(item.taxCategory) ||
    !Number.isInteger(item.gstRateBps) ||
    item.gstRateBps < 0 ||
    item.gstRateBps > 10000
  )
    fail("Explicit GST rate and tax category required");
  if (
    item.taxCategory === "taxable"
      ? item.gstRateBps === 0
      : item.gstRateBps !== 0
  )
    fail(
      "Taxable items require a positive GST rate; nil-rated and exempt items require zero",
    );
}
export function buildTaxSnapshot(
  mode,
  profile,
  customer,
  placeOfSupply,
  entries,
) {
  if (mode === "non_gst") return null; // Historical businesses remain usable.
  if (!["composition", "regular_gst"].includes(mode))
    fail("Document mode is not active");
  validateParty(profile, { supplier: true });
  validateParty(customer);
  if (!STATE_CODES.has(placeOfSupply))
    fail("Explicit Indian place of supply state code required");
  if (
    mode === "regular_gst" &&
    profile.stateCode === placeOfSupply &&
    UTGST_CODES.has(profile.stateCode)
  )
    fail("Intraterritory UTGST supplies are not supported");
  if (customer?.gstin && (!customer.address || !customer.stateCode))
    fail("Registered customer address and state code required");
  if (mode === "composition" && placeOfSupply !== profile.stateCode)
    fail("Interstate composition supplies are not supported");
  const taxable = entries.some((e) => e.item.taxCategory === "taxable");
  const untaxed = entries.some((e) =>
    ["exempt", "nil_rated"].includes(e.item.taxCategory),
  );
  if (mode === "regular_gst" && taxable && untaxed && customer?.gstin)
    fail(
      "Mixed taxable and exempt supplies to registered recipients are not supported",
    );
  if (
    entries.reduce((n, e) => n + BigInt(e.amountMinor), 0n) >= 5000000n &&
    (!customer?.name || !customer.address || !customer.stateCode)
  )
    fail(
      "Recipient name, address and state required for supplies of fifty thousand rupees or more",
    );
  const documentType =
    mode === "composition" || !taxable
      ? "bill_of_supply"
      : untaxed
        ? "invoice_cum_bill_of_supply"
        : "tax_invoice";
  const taxType =
    mode === "composition"
      ? "none"
      : placeOfSupply === profile.stateCode
        ? "intra"
        : "inter";
  const lines = entries.map(({ lineId, item, amountMinor }) => {
    if (mode === "composition") {
      if (!/^\d{4,8}$/.test(item.hsn ?? ""))
        fail("Valid HSN required for GST documents");
    } else validateItemTax(item);
    const amount = BigInt(amountMinor),
      rate =
        mode === "regular_gst" && item.taxCategory === "taxable"
          ? BigInt(item.gstRateBps)
          : 0n;
    const tax = (amount * rate + (10000n + rate) / 2n) / (10000n + rate);
    const cgst = taxType === "intra" ? (tax + 1n) / 2n : 0n,
      sgst = taxType === "intra" ? tax / 2n : 0n,
      igst = taxType === "inter" ? tax : 0n;
    return {
      lineId,
      hsn: item.hsn,
      taxCategory: item.taxCategory ?? null,
      gstRateBps: item.gstRateBps ?? null,
      cgstRateBps: taxType === "intra" ? Number(rate) / 2 : 0,
      sgstRateBps: taxType === "intra" ? Number(rate) / 2 : 0,
      igstRateBps: taxType === "inter" ? Number(rate) : 0,
      taxableMinor: String(amount - tax),
      cgstMinor: String(cgst),
      sgstMinor: String(sgst),
      igstMinor: String(igst),
      amountMinor: String(amount),
    };
  });
  const sum = (key) =>
    String(lines.reduce((n, line) => n + BigInt(line[key]), 0n));
  return {
    mode,
    documentType,
    taxType,
    placeOfSupply,
    stateCode: profile.stateCode,
    subtotalMinor: sum("taxableMinor"),
    taxableMinor: String(
      lines
        .filter((l) => l.taxCategory === "taxable")
        .reduce((n, l) => n + BigInt(l.taxableMinor), 0n),
    ),
    cgstMinor: sum("cgstMinor"),
    sgstMinor: sum("sgstMinor"),
    igstMinor: sum("igstMinor"),
    totalMinor: sum("amountMinor"),
    lines,
  };
}
