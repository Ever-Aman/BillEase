# GST document options: requirements and e-invoicing

Research snapshot: 30 October 2026. This note summarizes central GST requirements for product design. It is not a determination that a particular business or transaction is compliant; state/UT GST rules generally mirror CGST, and transaction facts matter.

## Pick the document per supply

| Situation | GST document to support |
|---|---|
| Regular registered supplier, taxable supply | Tax invoice under CGST Act §31(1)/(2) and Rule 46. |
| Composition taxpayer, or registered supplier making an exempt supply | Bill of supply under §31(3)(c) and Rule 49, instead of a tax invoice. A composition dealer must not collect tax from the recipient. |
| Taxable and exempt supplies together to an unregistered recipient | Rule 46A permits one invoice-cum-bill of supply. |

Do not equate business registration type with the document required for every sale: a regular registered business can make exempt supplies that need a bill of supply. The Act also permits a small-value exception below ₹200 subject to prescribed conditions. [CGST Act §31](https://cbic-gst.gov.in/aces/Documents/CGST-bill-e.pdf), [CBIC Invoice Rules](https://cbic-gst.gov.in/gst-invoice-rules.html)

### Statutory fields

**Tax invoice (Rule 46):** supplier name, address and GSTIN; financial-year-unique consecutive serial number; issue date; registered recipient name/address/GSTIN or UIN; for an unregistered recipient, recipient and delivery details plus State/code when taxable supply is ₹50,000 or more (with further prescribed cases); HSN/service accounting code; description; goods quantity/UQC; total and taxable values (after discount/abatement); tax rate and tax amount; inter-State place of supply and State; distinct delivery address when applicable; reverse-charge indicator; and supplier/authorized representative signature, subject to electronic invoice exception. Exports have specific endorsement and destination fields. The rules permit specified particulars to be omitted in allowed cases and impose other conditional requirements: treat this as a base checklist, not an exhaustive rule engine. [CBIC Rule 46](https://cbic-gst.gov.in/gst-invoice-rules.html)

**Bill of supply (Rule 49):** supplier name, address and GSTIN; financial-year-unique consecutive serial number; issue date; recipient name/address/GSTIN or UIN if registered; HSN/service accounting code; description; supply value after discount/abatement; supplier/authorized representative signature. Certain Rule 46 provisos apply mutatis mutandis. [CBIC Rule 49](https://cbic-gst.gov.in/gst-invoice-rules.html)

### Inclusive prices

Inclusive pricing is a valid presentation choice, not a different invoice type. Section 33 requires the tax amount to be prominently indicated in tax invoices and other relevant documents even when it forms part of the displayed price. Rule 35 gives the extraction formula when value is tax-inclusive: `tax = inclusive value × applicable tax rate / (100 + sum of applicable tax rates)`. Thus a layout may emphasize a single customer-facing total while still presenting required taxable value, rate and tax amount. [CGST Act §33](https://cbic-gst.gov.in/aces/Documents/CGST-bill-e.pdf), [CBIC Rule 35 PDF](https://cbic-gst.gov.in/pdf/01062021-CGST-Rules-2017-Part-A-Rules.pdf)

## Layout choice is flexible

The cited Act and rules prescribe invoice data and some document-handling requirements; they do not prescribe a fixed visual page design. CBIC publishes particulars, not a mandatory graphic template. Three viable design directions (all still need every applicable statutory field):

1. **Compact shop bill:** prominent business identity and grand total, concise item list, with tax breakup clearly visible and required party/transaction data.
2. **Classic business bill:** seller and recipient panels, item/tax table, totals, notes and signature, using a full-width A4 page.
3. **Clean digital bill:** restrained colour, clear legal identity and party details, then item details and a prominent total, suited to PDF sharing.

The six-page comparison at `output/pdf/billease-bill-layout-options.pdf` has a composition and regular-GST variant for each option, with fictional data. These are newly prepared layouts based on the official particulars, not downloaded or government-approved templates. They illustrate one unregistered-customer, intra-State goods sale; registered recipient GSTINs, other supplies, exports, mixed tax rates and any applicable IRP data need conditional handling in the actual renderer.

### Selected layout and requested columns

Aman selected **Classic business bill**. The revised three-page preview is `output/pdf/billease-classic-bill-preview.pdf`: composition, intra-State regular GST and inter-State regular GST. Regular GST has separate item, HSN, quantity, inclusive unit price, GST rate, taxable amount, GST amount and line total columns. A rate-wise breakdown below shows CGST/SGST for the illustrated intra-State sale or IGST for the illustrated inter-State sale. The Bill of Supply has item, HSN, quantity, unit price and amount columns, with no tax columns. These are preview artifacts; product renderer, GST calculation/storage and admin business-type implementation remain separate development work.

Aman then supplied a visual invoice reference and requested a smaller breakdown. The preview's GST breakdown is a compact, right-aligned table below the items; the reference is used for layout direction only, not its example business details, payment identifiers, wording or tax calculations.

These are product/design options, not government-approved templates. Final choice should account for the business's actual supplies and print/email/PDF use. No accountant-provided sample is a legal prerequisite in the cited rules.

## E-invoice in plain language

“E-invoice” does not mean the government designs the PDF. A covered supplier creates its invoice in its billing/accounting system, reports the structured invoice data to an Invoice Registration Portal (IRP), and receives an IRN (Invoice Reference Number) plus an IRP digitally signed QR code. The issued invoice needs those returned identifiers where e-invoicing applies; the QR lets a recipient verify the reported invoice. The supplier can still choose the visual rendering, while retaining the required data and returned IRP information. [GSTN IITF 2025 e-Invoice brochure](https://www.gstn.org.in/assets/mainDashboard/Pdf/Final_e-Invoice_Brochure_Design_for_IITF%202025.pdf), [GSTN IRP explanation](https://einvoice6.gst.gov.in/content/how-will-recipients-receive-e-invoices-from-their-suppliers/)

As of this research date, GSTN's brochure says the threshold is **aggregate turnover exceeding ₹5 crore in any preceding financial year from 2017–18 onward**. Turnover is PAN-wide across GST registrations; once crossed, the brochure says all GSTINs under the PAN comply from the beginning of the next financial year. Confirm current applicability for an actual PAN using the official portal/notifications. [GSTN IITF 2025 brochure](https://www.gstn.org.in/assets/mainDashboard/Pdf/Final_e-Invoice_Brochure_Design_for_IITF%202025.pdf), [IRP applicability explanation](https://einvoice6.gst.gov.in/content/einvoice-mandate/)

The mandate generally covers tax invoices, debit notes and credit notes for B2B, exports, SEZ and deemed exports for a notified taxpayer. B2C supplies are not within this e-invoice/IRN mandate. A bill of supply (including the usual composition document) is not reported as an e-invoice. Important exceptions apply to notified classes/entities, including SEZ units (SEZ developers are distinct), insurers, banks/financial institutions, NBFCs, GTAs and passenger transport suppliers; government departments/local authorities also have a notification-based exclusion. Check the current Rule 48(4), notifications and taxpayer-specific applicability before promising e-invoice compliance. A separate B2C dynamic QR requirement may apply to some businesses and is not the same as an IRP e-invoice QR. [GSTN IITF 2025 brochure](https://www.gstn.org.in/assets/mainDashboard/Pdf/Final_e-Invoice_Brochure_Design_for_IITF%202025.pdf), [GSTN/IRP FAQ](https://einvoice6.gst.gov.in/content/faq-powered-by-irisirp/), [CBIC central tax notifications](https://cbic-gst.gov.in/hindi/central-tax-notifications.html)

## Product implication

Offer separate document variants for tax invoice and bill of supply, select the document based on the transaction/supply classification, and make e-invoice fields conditional on the user's applicable mandate and covered transaction. Avoid labeling a layout “GST compliant” absent the business, supply, jurisdiction and current-rule facts needed to validate it.
