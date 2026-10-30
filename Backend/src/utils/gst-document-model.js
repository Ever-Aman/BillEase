const stateNames = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  10: "Bihar",
  11: "Sikkim",
  12: "Arunachal Pradesh",
  13: "Nagaland",
  14: "Manipur",
  15: "Mizoram",
  16: "Tripura",
  17: "Meghalaya",
  18: "Assam",
  19: "West Bengal",
  20: "Jharkhand",
  21: "Odisha",
  22: "Chhattisgarh",
  23: "Madhya Pradesh",
  24: "Gujarat",
  26: "Dadra and Nagar Haveli and Daman and Diu",
  27: "Maharashtra",
  29: "Karnataka",
  30: "Goa",
  31: "Lakshadweep",
  32: "Kerala",
  33: "Tamil Nadu",
  34: "Puducherry",
  35: "Andaman and Nicobar Islands",
  36: "Telangana",
  37: "Andhra Pradesh",
  38: "Ladakh",
};

// Rates may contain a half basis point after splitting an odd overall rate.
// This formats the supplied rate only; all monetary calculation lives in GST services.
const percent = (value) =>
  value == null ? undefined : String(Number(value) / 100);

export function gstDocumentModel(snapshot, lines, { quotation = false } = {}) {
  const tax = snapshot?.tax;
  if (!tax)
    return { title: quotation ? "QUOTATION" : "BILL", mode: "non_gst", lines };
  const byId = new Map(tax.lines.map((line) => [line.lineId, line]));
  const billOfSupply = tax.documentType === "bill_of_supply";
  return {
    title: quotation
      ? "QUOTATION"
      : billOfSupply
        ? "BILL OF SUPPLY"
        : tax.documentType === "invoice_cum_bill_of_supply"
          ? "INVOICE-CUM-BILL OF SUPPLY"
          : "TAX INVOICE",
    mode:
      tax.mode === "composition"
        ? "composition"
        : billOfSupply
          ? "bill_of_supply"
          : "regular",
    taxType: tax.taxType,
    placeOfSupply: `${stateNames[tax.placeOfSupply] ?? tax.placeOfSupply} (${tax.placeOfSupply})`,
    countryOfSupply: "India",
    subtotalMinor: tax.subtotalMinor,
    taxableMinor: tax.taxableMinor,
    cgstMinor: tax.cgstMinor,
    sgstMinor: tax.sgstMinor,
    igstMinor: tax.igstMinor,
    lines: lines.map((line) => {
      const saved = byId.get(line.id);
      if (!saved)
        throw Object.assign(new Error("Original line tax snapshot missing"), {
          status: 409,
        });
      return {
        ...line,
        hsn: saved.hsn,
        taxableMinor: saved.taxableMinor,
        cgstRate: percent(saved.cgstRateBps),
        sgstRate: percent(saved.sgstRateBps),
        igstRate: percent(saved.igstRateBps),
        cgstMinor: saved.cgstMinor,
        sgstMinor: saved.sgstMinor,
        igstMinor: saved.igstMinor,
        amountMinor: saved.amountMinor,
      };
    }),
  };
}
