import PDFDocument from "pdfkit";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { renderInvoiceLayout } from "../src/utils/invoice-layout.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const supplier = {
  name: "NORTHLINE\nSTUDIO",
  address:
    "18 Example Avenue, Indiranagar\nBengaluru, Karnataka, India - 560038",
  gstin: "29AAAAA0000A1Z5",
  pan: "AAAAA0000A",
  bankDetails: {
    accountHolderName: "Northline Studio (fictional)",
    accountNumber: "000000000000",
    ifsc: "SAMPLE00000",
    accountType: "Current",
    bankName: "Example Bank",
    upi: "Not enabled - sample only",
  },
  terms:
    "1. This is a fictional layout sample, not a valid invoice or payment request.\n2. Actual payment terms appear only when configured by the supplier.",
  notes:
    "All names, tax identifiers, account details and values on this page are fictional. The production renderer uses the recorded supplier, customer and tax snapshot. No payment QR is generated.",
  email: "sample@example.invalid",
  phone: "+91 00000 00000",
};
const customer = {
  name: "Example Creative Company",
  address: "305 Example Business Park\nBengaluru, Karnataka, India - 560001",
  gstin: "29BBBBB0000B1Z5",
  pan: "BBBBB0000B",
};
const descriptions = [
  "Basic Web Development",
  "Logo Design",
  "Web Design",
  "Full Stack Web Development",
];
const base = {
  number: "SAMPLE-004",
  date: "2026-10-30",
  dueDate: "2026-11-14",
  supplier,
  customer,
  placeOfSupply: "Karnataka",
  countryOfSupply: "India",
  status: "SAMPLE - FICTIONAL / NOT FOR PAYMENT",
  subtotalMinor: "4000000",
  totalMinor: "4720000",
  amountWords: "Forty-Seven Thousand Two Hundred Rupees Only",
};
const intra = {
  ...base,
  title: "Invoice",
  mode: "regular",
  taxType: "intra",
  taxableMinor: "4000000",
  cgstMinor: "360000",
  sgstMinor: "360000",
  lines: descriptions.map((description, i) => ({
    description,
    hsn: "9983",
    quantity: i ? "1" : "10",
    cgstRate: "9",
    sgstRate: "9",
    taxableMinor: "1000000",
    cgstMinor: "90000",
    sgstMinor: "90000",
    amountMinor: "1180000",
  })),
};
const inter = {
  ...base,
  title: "Invoice",
  number: "SAMPLE-005",
  mode: "regular",
  taxType: "inter",
  placeOfSupply: "Maharashtra",
  taxableMinor: "4000000",
  igstMinor: "720000",
  lines: descriptions.map((description) => ({
    description,
    hsn: "9983",
    quantity: "1",
    igstRate: "18",
    taxableMinor: "1000000",
    igstMinor: "180000",
    amountMinor: "1180000",
  })),
};
const composition = {
  ...base,
  title: "Bill of Supply",
  number: "SAMPLE-003",
  mode: "composition",
  totalMinor: "4000000",
  amountWords: "Forty Thousand Rupees Only",
  lines: descriptions.map((description) => ({
    description,
    hsn: "9983",
    quantity: "1",
    unitPriceMinor: "1000000",
    amountMinor: "1000000",
  })),
};
async function save(path, models) {
  const doc = new PDFDocument({
    size: "A4",
    margin: 28,
    info: { Title: "BillEase - fictional reference layout samples" },
  });
  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on("end", resolve);
    doc.on("error", reject);
  });
  models.forEach((model, index) => {
    if (index) doc.addPage({ size: "A4", margin: 28 });
    renderInvoiceLayout(doc, model);
  });
  doc.end();
  await done;
  await writeFile(path, Buffer.concat(chunks));
  console.log(path);
}
await mkdir(`${root}output/pdf`, { recursive: true });
await mkdir(`${root}tmp/pdfs`, { recursive: true });
await save(`${root}output/pdf/billease-reference-template.pdf`, [
  composition,
  intra,
  inter,
]);
await save(`${root}tmp/pdfs/billease-layout-stress.pdf`, [
  {
    ...intra,
    lines: [
      ...intra.lines,
      {
        ...intra.lines[0],
        description:
          "Long description start. " +
          "Service milestone details, delivery and review documentation. ".repeat(
            400,
          ) +
          " Long description end.",
      },
    ],
    supplier: {
      ...supplier,
      terms:
        supplier.terms +
        "\n" +
        "Extended configured contractual term. ".repeat(300),
    },
  },
]);
