import { fileURLToPath } from "node:url";

/** Integer paise only: formatting never passes monetary amounts through Number. */
export function formatMinor(value = "0") {
  if (!/^-?\d+$/.test(String(value)))
    throw new TypeError("Money must be integer minor units");
  const amount = BigInt(value),
    absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? "-" : ""}${String(absolute / 100n).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${String(absolute % 100n).padStart(2, "0")}`;
}

/** Render an already calculated snapshot. No tax, discounts, defaults or payment QR are invented. */
export function renderInvoiceLayout(doc, model) {
  doc.registerFont(
    "Invoice",
    fileURLToPath(
      new URL("../../assets/fonts/DejaVuSans.ttf", import.meta.url),
    ),
  );
  doc.registerFont(
    "InvoiceBold",
    fileURLToPath(
      new URL("../../assets/fonts/DejaVuSans-Bold.ttf", import.meta.url),
    ),
  );
  const left = 28,
    right = 567.28,
    width = right - left,
    bottom = 785;
  let page = 1,
    y = 28;
  const str = (value) =>
    value == null ? "" : String(value).replace(/[\u2010-\u2015]/g, "-");
  function font(size = 9, bold = false) {
    doc.font(bold ? "InvoiceBold" : "Invoice").fontSize(size);
  }
  function wrap(value, w, size = 9, bold = false) {
    font(size, bold);
    const out = [];
    for (const paragraph of str(value).split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        if (line && doc.widthOfString(`${line} ${word}`) > w) {
          out.push(line);
          line = "";
        }
        for (const char of word) {
          if (line && doc.widthOfString(line + char) > w) {
            out.push(line);
            line = "";
          }
          line += char;
        }
        line += " ";
      }
      out.push(line.trimEnd());
    }
    return out;
  }
  function text(
    value,
    x,
    at,
    w,
    size = 9,
    bold = false,
    color = "#202020",
    align = "left",
  ) {
    font(size, bold);
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .fillColor(color)
      .text(str(value), x, at, { width: w, lineBreak: false, align });
    doc.page.margins.bottom = savedBottom;
  }
  function rule(at, x = left, w = width) {
    doc
      .strokeColor("#dfdfdf")
      .lineWidth(0.5)
      .moveTo(x, at)
      .lineTo(x + w, at)
      .stroke();
  }
  function footer() {
    rule(804);
    text(model.number, left, 813, width - 100, 7, false, "#777777");
    text(`Page ${page}`, right - 70, 813, 70, 7, false, "#777777", "right");
  }
  function next() {
    footer();
    doc.addPage({ size: "A4", margin: 28 });
    page++;
    y = 28;
    const heading = wrap(
      `${model.title || "Invoice"} | ${str(model.number)}${model.status ? ` | ${model.status}` : ""}`,
      width,
      10,
      true,
    );
    for (const line of heading) {
      text(line, left, y, width, 10, true);
      y += 15;
    }
    rule(y + 2);
    y += 15;
  }
  function flow(
    value,
    x,
    w,
    size = 9,
    bold = false,
    color = "#202020",
    gap = 4,
  ) {
    for (const line of wrap(value, w, size, bold)) {
      if (y + size + gap > bottom) next();
      text(line, x, y, w, size, bold, color);
      y += size + gap;
    }
  }
  function section(title, content, x = left, w = width) {
    if (!content) return;
    if (y + 42 > bottom) next();
    flow(title, x, w, 10, true);
    y += 3;
    flow(content, x, w, 8, false, "#666666");
    y += 12;
  }
  const supplier = model.supplier || {},
    customer = model.customer || {};
  const titleLines = wrap(model.title || "Invoice", width * 0.53, 21);
  for (const line of titleLines) {
    text(line, left, y, width * 0.53, 21);
    y += 27;
  }
  if (model.status) {
    text(model.status, left, y + 2, width * 0.53, 8, true, "#777777");
    y += 18;
  }
  y += 13;
  const dateLabel = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(str(value))) return value;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    }).format(date);
  };
  const meta = [
    ["Invoice#", model.number],
    ["Invoice Date", dateLabel(model.date)],
    ...(model.dueDate ? [["Due Date", dateLabel(model.dueDate)]] : []),
  ];
  for (const [key, value] of meta) {
    const lines = wrap(value, 165, 8, true);
    text(key, left, y, 77, 8);
    for (const line of lines) {
      text(line, left + 80, y, 165, 8, true);
      y += 13;
    }
    y += 6;
  }
  let brandBottom = 100;
  if (Buffer.isBuffer(supplier.logo)) {
    try {
      doc.image(supplier.logo, right - 170, 63, {
        fit: [170, 65],
        align: "right",
      });
      brandBottom = 128;
    } catch {
      /* Malformed optional image cannot make a financial document unreadable. */
    }
  } else {
    const brand = wrap(supplier.name, 205, 18, true).slice(0, 4);
    brand.forEach((line, index) =>
      text(
        line,
        right - 205,
        66 + index * 24,
        205,
        18,
        true,
        "#484848",
        "right",
      ),
    );
    brandBottom = 66 + brand.length * 24;
  }
  y = Math.max(y + 12, brandBottom + 14);
  if (model.mode === "composition") {
    flow(
      "Composition taxable person, not eligible to collect tax on supplies.",
      left,
      width,
      8,
      true,
      "#555555",
    );
    y += 12;
  }
  function partyLines(party) {
    return [
      party.name,
      party.address,
      party.phone ? `Phone  ${party.phone}` : "",
      party.email ? `Email  ${party.email}` : "",
      party.gstin ? `GSTIN  ${party.gstin}` : "",
      party.pan ? `PAN  ${party.pan}` : "",
    ]
      .filter(Boolean)
      .flatMap((value) => wrap(value, (width - 16) / 2 - 30, 8));
  }
  const parties = [partyLines(supplier), partyLines(customer)];
  let offset = 0;
  do {
    if (y + 80 > bottom) next();
    const count = Math.min(
      Math.max(parties[0].length, parties[1].length) - offset,
      Math.floor((bottom - y - 44) / 12),
    );
    const panelHeight = 44 + Math.max(1, count) * 12,
      panelWidth = (width - 16) / 2;
    [0, 1].forEach((index) => {
      const x = left + index * (panelWidth + 16);
      doc.roundedRect(x, y, panelWidth, panelHeight, 3).fill("#f0f0f0");
      text(
        `${index ? "Billed to" : "Billed by"}${offset ? " (continued)" : ""}`,
        x + 15,
        y + 13,
        panelWidth - 30,
        11,
      );
      parties[index]
        .slice(offset, offset + count)
        .forEach((line, n) =>
          text(
            line,
            x + 15,
            y + 36 + n * 12,
            panelWidth - 30,
            8,
            offset + n === 0,
          ),
        );
    });
    y += panelHeight + 12;
    offset += count;
    if (offset < Math.max(parties[0].length, parties[1].length)) next();
  } while (offset < Math.max(parties[0].length, parties[1].length));
  if (model.placeOfSupply || model.countryOfSupply) {
    const half = (width - 16) / 2;
    const supply = [
      wrap(
        model.placeOfSupply ? `Place of Supply   ${model.placeOfSupply}` : "",
        half,
        8,
      ),
      wrap(
        model.countryOfSupply
          ? `Country of Supply   ${model.countryOfSupply}`
          : "",
        half,
        8,
      ),
    ];
    for (
      let row = 0;
      row < Math.max(...supply.map((lines) => lines.length));
      row++
    ) {
      if (y + 12 > bottom) next();
      supply.forEach((lines, index) =>
        text(
          lines[row] || "",
          left + index * (half + 16),
          y,
          half,
          8,
          false,
          "#555555",
        ),
      );
      y += 12;
    }
    y += 10;
  }
  const regular = model.mode === "regular",
    inter = model.taxType === "inter";
  const columns = regular
    ? inter
      ? [
          ["Item / Description", 162, "description"],
          ["HSN", 34, "hsn"],
          ["Qty.", 30, "quantity"],
          ["IGST %", 45, "igstRate"],
          ["Taxable", 90, "taxableMinor"],
          ["IGST amt", 80, "igstMinor"],
          ["Amount", width - 441, "amountMinor"],
        ]
      : [
          ["Item / Description", 132, "description"],
          ["HSN", 32, "hsn"],
          ["Qty.", 28, "quantity"],
          ["CGST %", 34, "cgstRate"],
          ["SGST %", 34, "sgstRate"],
          ["Taxable", 65, "taxableMinor"],
          ["CGST amt", 57, "cgstMinor"],
          ["SGST amt", 57, "sgstMinor"],
          ["Amount", width - 439, "amountMinor"],
        ]
    : [
        ["Item / Description", 255, "description"],
        ["HSN", 44, "hsn"],
        ["Qty.", 40, "quantity"],
        ["Unit price", 100, "unitPriceMinor"],
        ["Amount", width - 439, "amountMinor"],
      ];
  function tableHeader() {
    if (y + 50 > bottom) next();
    doc.roundedRect(left, y, width, 28, 3).fill("#484848");
    let x = left;
    for (const [label, w, key] of columns) {
      text(
        label,
        x + 4,
        y + 9,
        w - 8,
        6.2,
        false,
        "#ffffff",
        key === "description" ? "left" : "right",
      );
      x += w;
    }
    y += 35;
  }
  tableHeader();
  (model.lines || []).forEach((line, rowIndex) => {
    const values = columns.map(([, w, key]) => {
      let value = line[key];
      if (key === "description") value = `${rowIndex + 1}. ${str(value)}`;
      else if (key.endsWith("Minor"))
        value = value == null ? "-" : `₹ ${formatMinor(value)}`;
      else if (key.endsWith("Rate"))
        value = value == null ? "-" : `${str(value)}%`;
      else if (key === "quantity")
        value = `${str(value)}${line.unitLabel ? ` ${line.unitLabel}` : ""}`;
      return wrap(value == null || value === "" ? "-" : value, w - 8, 7);
    });
    const length = Math.max(...values.map((value) => value.length));
    let offset = 0;
    while (offset < length) {
      if (y + 24 > bottom) {
        next();
        tableHeader();
      }
      const count = Math.min(
        length - offset,
        Math.max(1, Math.floor((bottom - y - 9) / 11)),
      );
      let x = left;
      columns.forEach(([, w, key], index) => {
        values[index]
          .slice(offset, offset + count)
          .forEach((value, n) =>
            text(
              value,
              x + 4,
              y + n * 11,
              w - 8,
              7,
              false,
              "#202020",
              key === "description" ? "left" : "right",
            ),
          );
        x += w;
      });
      y += count * 11 + 12;
      offset += count;
      if (offset < length) {
        next();
        tableHeader();
      }
    }
    rule(y - 5);
  });
  y += 14;
  const totals = [
    ["Sub Total", model.subtotalMinor],
    ...(model.discountMinor == null ? [] : [["Discount", model.discountMinor]]),
    ...(regular
      ? [
          ["Taxable Amount", model.taxableMinor],
          ...(inter
            ? [["IGST", model.igstMinor]]
            : [
                ["CGST", model.cgstMinor],
                ["SGST", model.sgstMinor],
              ]),
        ]
      : []),
  ].filter(([, value]) => value != null);
  const bankLabels = {
    accountHolderName: "Account Holder",
    accountName: "Account Holder",
    accountNumber: "Account Number",
    ifsc: "IFSC",
    accountType: "Account Type",
    bankName: "Bank",
    bank: "Bank",
    branch: "Branch",
    upiId: "UPI",
    upi: "UPI",
  };
  const bank = Object.entries(supplier.bankDetails || {})
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => `${bankLabels[key] || key}   ${str(value)}`)
    .join("\n");
  const totalHeight =
    totals.length * 24 +
    60 +
    (model.amountWords ? wrap(model.amountWords, 213, 9).length * 13 + 25 : 0);
  if (y + Math.min(totalHeight, 400) > bottom) next();
  const summaryTop = y,
    summaryX = right - 213,
    summaryPage = page;
  for (const [label, value] of totals) {
    const money = wrap(`₹ ${formatMinor(value)}`, 118, 9);
    text(label, summaryX, y, 94, 9);
    for (const item of money) {
      text(item, summaryX + 95, y, 118, 9, false, "#202020", "right");
      y += 13;
    }
    y += 11;
  }
  rule(y, summaryX, 213);
  y += 12;
  const totalValue = `₹ ${formatMinor(model.totalMinor)}`;
  let totalSize = 13;
  font(totalSize, true);
  while (totalSize > 6 && doc.widthOfString(totalValue) > 150) {
    totalSize -= 0.5;
    font(totalSize, true);
  }
  const totalMoney = wrap(totalValue, 150, totalSize, true);
  text("Total", summaryX, y, 60, 12);
  for (const line of totalMoney) {
    text(line, right - 150, y, 150, totalSize, true, "#202020", "right");
    y += 18;
  }
  y += 10;
  if (model.amountWords) {
    flow("Invoice Total (in words)", summaryX, 213, 7, false, "#777777");
    flow(model.amountWords, summaryX, 213, 9);
  }
  const totalsEnd = y;
  y = summaryTop;
  if (bank || Buffer.isBuffer(supplier.paymentQr)) {
    section("Bank & Payment Details", bank || "Payment QR", left, 300);
    if (Buffer.isBuffer(supplier.paymentQr)) {
      if (y + 112 > bottom) next();
      try {
        doc.image(supplier.paymentQr, left, y, { fit: [100, 100] });
        y += 112;
      } catch {
        /* Invalid optional image is omitted. */
      }
    }
  }
  section("Terms and Conditions", supplier.terms, left, 300);
  section("Additional Notes", supplier.notes, left, 300);
  // These independent columns share their top; following full-width content starts below both.
  y = (page === summaryPage ? Math.max(y, totalsEnd) : y) + 12;
  if (model.notice) section("Notice", model.notice);
  for (const extra of model.extraSections || [])
    section(extra.title || "Details", (extra.lines || []).join("\n"));
  if (supplier.signatory)
    section("Authorized Signatory", supplier.signatory, right - 213, 213);
  if (supplier.email || supplier.phone) {
    y += 8;
    flow(
      [supplier.email, supplier.phone].filter(Boolean).join("  |  "),
      left,
      width,
      7,
      false,
      "#777777",
    );
  }
  footer();
  return { pageCount: page };
}
