import test from "node:test";
import assert from "node:assert/strict";
import PDFDocument from "pdfkit";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const fixture = (overrides = {}) => ({
  title: "Tax Invoice",
  number: "SAMPLE-004",
  date: "30 Oct 2026",
  supplier: {
    name: "Sample Supplier",
    address: "Bengaluru, Karnataka",
    bankDetails: {
      accountHolderName: "Sample Supplier",
      accountNumber: "0000000042",
      ifsc: "TEST0000001",
    },
  },
  customer: { name: "Sample Buyer", address: "Bengaluru, Karnataka" },
  mode: "regular",
  taxType: "intra",
  lines: [
    {
      description: "Design service",
      hsn: "9983",
      quantity: "1",
      cgstRate: "9",
      sgstRate: "9",
      taxableMinor: "1000000",
      cgstMinor: "90000",
      sgstMinor: "90000",
      amountMinor: "1180000",
    },
  ],
  subtotalMinor: "1000000",
  taxableMinor: "1000000",
  cgstMinor: "90000",
  sgstMinor: "90000",
  totalMinor: "1180000",
  status: "SAMPLE",
  ...overrides,
});
async function render(model) {
  const module = await import("../src/utils/invoice-layout.js");
  assert.equal(
    typeof module.renderInvoiceLayout,
    "function",
    "reusable renderer exists",
  );
  const dir = await mkdtemp(join(tmpdir(), "invoice-layout-"));
  try {
    const doc = new PDFDocument({ size: "A4", margin: 28 });
    const chunks = [];
    doc.on("data", (x) => chunks.push(x));
    const done = new Promise((resolve, reject) => {
      doc.on("end", resolve);
      doc.on("error", reject);
    });
    module.renderInvoiceLayout(doc, model);
    doc.end();
    await done;
    const path = join(dir, "test.pdf");
    await writeFile(path, Buffer.concat(chunks));
    return {
      text: execFileSync("pdftotext", ["-layout", path, "-"], {
        encoding: "utf8",
      }),
      bbox: execFileSync("pdftotext", ["-bbox", path, "-"], {
        encoding: "utf8",
      }),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
test("separate CGST and SGST rate columns preserve explicit tax and integer money", async () => {
  const { text } = await render(fixture());
  assert.match(text, /CGST\s*%/);
  assert.match(text, /SGST\s*%/);
  assert.match(text, /11,800\.00/);
  assert.match(text, /900\.00/);
  assert.match(text, /Billed by/);
  assert.match(text, /Billed to/);
  assert.match(text, /Bank & Payment Details/);
});
test("composition and non GST documents omit tax columns without inventing HSN", async () => {
  for (const mode of ["composition", "non_gst"]) {
    const { text } = await render(
      fixture({
        mode,
        lines: [
          {
            description: "Untaxed goods",
            quantity: "2",
            unitPriceMinor: "500",
            amountMinor: "1000",
          },
        ],
        totalMinor: "1000",
      }),
    );
    assert.doesNotMatch(text, /CGST|SGST|IGST/);
    assert.match(text, /10\.00/);
    assert.doesNotMatch(text, /9983/);
  }
});
test("interstate uses IGST snapshot, including exact large integer monetary values", async () => {
  const { text } = await render(
    fixture({
      taxType: "inter",
      igstMinor: "180000",
      totalMinor: "9007199254740993",
      lines: [
        {
          description: "Interstate item",
          quantity: "1",
          igstRate: "18",
          igstMinor: "180000",
          amountMinor: "1180000",
        },
      ],
    }),
  );
  assert.match(text, /IGST\s*%/);
  assert.doesNotMatch(text, /CGST|SGST/);
  assert.match(text, /90,071,992,547,409\.93/);
});
test("long descriptions continue across pages with repeated headers and bounded text", async () => {
  const description =
    "LONGROW " +
    "Detailed service delivery and documentation ".repeat(420) +
    " LASTTOKEN";
  const { text, bbox } = await render(
    fixture({
      lines: [{ description, quantity: "1", amountMinor: "1180000" }],
    }),
  );
  const pages = text.split("\f").filter((x) => x.trim());
  assert.ok(pages.length >= 3);
  assert.match(text, /LASTTOKEN/);
  for (const page of pages.slice(0, -1)) assert.match(page, /Item/);
  for (const match of bbox.matchAll(
    /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)"/g,
  )) {
    assert.ok(Number(match[1]) >= 25 && Number(match[3]) <= 570, match[0]);
    assert.ok(Number(match[2]) >= 20 && Number(match[4]) <= 825, match[0]);
  }
});
test("money formatter rejects fractional minor units and preserves signed paise", async () => {
  const { formatMinor } = await import("../src/utils/invoice-layout.js");
  assert.equal(formatMinor("-101"), "-1.01");
  assert.equal(formatMinor("9007199254740993"), "90,071,992,547,409.93");
  assert.throws(() => formatMinor("1.5"));
});
test("timestamp dates use Indian civil date regardless of host timezone", async () => {
  const { text } = await render(
    fixture({ date: "2026-10-29T20:00:00.000Z", dueDate: "2026-11-01" }),
  );
  assert.match(text, /30 Oct 2026/);
  assert.match(text, /01 Nov 2026/);
  assert.doesNotMatch(text, /20:00/);
});
test("composition declaration precedes item table including draft documents", async () => {
  const declaration =
    "Composition taxable person, not eligible to collect tax on supplies.";
  const { text } = await render(
    fixture({
      mode: "composition",
      title: "DRAFT BILL OF SUPPLY",
      notice: "Draft only - not issued.",
    }),
  );
  assert.ok(text.indexOf(declaration) >= 0);
  assert.ok(text.indexOf(declaration) < text.indexOf("Item / Description"));
  assert.match(text, /Draft only - not issued/);
  const regular = await render(fixture());
  assert.doesNotMatch(regular.text, /Composition taxable person/);
});
