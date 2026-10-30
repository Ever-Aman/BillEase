# Business setup and first billing

Decisions confirmed by Aman on 30 October 2026.

## Who enters each detail

The admin creates the business, sets the business name, and assigns owner/staff access. The admin chooses Composition GST or Regular GST at creation. Existing non-GST records remain readable, but new non-GST onboarding is excluded. Each owner completes its billing/document profile afterward; staff and admin-only accounts cannot edit that profile. The profile's supplier/legal name can differ from the admin's display name, for example when a shop trades under a different name.

The owner enters:

- Official supplier/legal name as it should appear on bills.
- Registered/business billing address.
- Business contact phone.
- GSTIN and Indian state code for the registered business.
- Name of the authorised signatory, where applicable; this is a name field, not an uploaded digital-signature certificate.

No Aadhaar, personal identity-document upload, or private information sent to the developer is needed for this setup.

## Bills, quotations and the selected layout

Composition businesses issue Bills of Supply. Regular businesses issue GST tax invoices for taxable sales; all-exempt/nil-rated sales use Bills of Supply, and supported mixed unregistered-customer sales use an invoice-cum-bill of supply. Quotations show estimated tax without creating debt, and conversion revalidates current catalogue details.

All selling prices are inclusive. Regular documents separately show taxable amount, CGST and SGST rates/amounts or IGST; composition documents show HSN without tax columns. Aman's supplied reference determines the visual layout: invoice metadata and business logo/wordmark, two party panels, a dark table header and payment details beside totals. Optional payment QR/logo images must belong to that business.

Accountant-provided templates or approval are not required by this project. Actual GSTIN, supplier identity/state, HSN and applicable regular rates are required. Government e-invoicing is outside the requested scope.

Return and cancellation records retain original document references and reverse saved tax proportionally, without changing the original invoice. Their PDF histories and GST summaries are operational records; they are not government filings or separately issued statutory credit notes.

The current GST implementation handles supported domestic cases. Intraterritory UTGST, cess and export-specific documentation are not implemented and must not be treated as supported by the regular intra/inter-State calculations.

Sources: [CBIC composition rules](https://cbic-gst.gov.in/hindi/composition-rules.html), [CBIC invoicing rules](https://cbic-gst.gov.in/gst-invoice-rules.html).

## First invoice

Start the first new series at invoice **1**. The owner enters `0` as the last number already used when initializing the financial-year series. Issuing a bill increments it to `1`; subsequent bills continue sequentially. Repeating setup must not reset a series that already exists. Existing customer debts do not consume new invoice numbers.

## Existing customer debt

Before new billing, the owner creates/selects each customer and enters the outstanding amount through **Add opening balance → debt**. This records the unpaid balance carried into BillEase without inventing new sales. If a customer has an advance instead, enter it as an advance.

Record the balance cutover date and a source/reference in the note, then check the customer and business totals against the previous ledger. Do not also recreate old bills whose debt is included in the opening balance. The opening-balance UI has no separate backdating field; the cutover date in the note is contextual, while the recorded transaction keeps its actual creation time.

Actual customer balances remain for the owner to enter and verify. No amounts have been inferred or imported.

## Admin recovery and phone testing

Aman intends to use a personal email as the admin account identity, with email communications limited to recovery. The address still needs to be supplied through a protected setup channel. Email recovery remains disabled until a transactional provider/sender is verified; MFA and one-time recovery codes remain available. No password or recovery code belongs in project notes or chat.

Aman's Android phone will be used for development acceptance. USB connection/authorization, installation, notification delivery, device unlock, offline/reconnect behavior, and PDF sharing still need physical testing.
