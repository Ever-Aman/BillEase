# Flutter integration contract

Base URL: `/v1`. Business routes below are relative to `/v1/businesses/:businessId`. Send `Authorization: Bearer <accessToken>`, and JSON bodies with `Content-Type: application/json`. CSV import uses `text/csv`.

Amounts are integer paise. Responses represent PostgreSQL money and ledger IDs as decimal strings. Quantities entered by a user use integer `quantityMilli` (quantity × 1,000). Conversion factors and canonical quantities are decimal strings. Generate UUIDs on the phone for entities and operation IDs; retain submitted payloads unchanged until resolved.

Conversion factors must be positive, with at most nine integer digits and six decimal places. An entered quantity is limited to 100,000 units per line/event. These bounds keep converted quantities within the database's supported precision.

## Sign-in and personal security

| Method and path               | Purpose                                                                                                                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/login`            | Email/password, stable `deviceId`, `deviceName`, base64 SPKI Ed25519 `devicePublicKey`, optional `mfaCode` or `recoveryCode`. Returns access/refresh tokens, memberships and offline expiry. |
| `POST /auth/refresh`          | `{refreshToken}`; replace both returned tokens atomically in secure storage. Concurrent refreshes must be serialized on the phone.                                                           |
| `POST /auth/logout`           | `{refreshToken}`; closes that device's sessions, including a concurrent refresh.                                                                                                             |
| `GET /me`                     | Authenticated user `{id,email,isAdmin}`.                                                                                                                                                     |
| `GET /me/businesses`          | Current active business memberships.                                                                                                                                                         |
| `GET /me/devices`             | Own device names, activity and current device indicator.                                                                                                                                     |
| `DELETE /me/devices/:id`      | Revoke an own device and its sessions. Signed old work can still go to recovery quarantine.                                                                                                  |
| `POST /me/logout-all`         | `{}`; revoke all own sessions.                                                                                                                                                               |
| `GET /me/mfa`                 | Active/pending status; never returns secrets or codes.                                                                                                                                       |
| `POST /me/mfa/setup`          | Owner/admin `{password}`; returns a secret and `otpauthUri` for ten minutes.                                                                                                                 |
| `POST /me/mfa/confirm`        | `{code}`; verifies the authenticator, enables MFA, revokes other sessions and returns ten recovery codes once.                                                                               |
| `POST /me/mfa/recovery-codes` | Password plus exactly one of `mfaCode`/`recoveryCode`; replaces all recovery codes and returns the new set once.                                                                             |
| `POST /me/mfa/disable`        | Owner password plus fresh factor; revokes other sessions and invalidates recovery codes. Admin MFA cannot be disabled here.                                                                  |

Admin bootstrap and first MFA setup use the local CLI commands in README. Email recovery is inactive by decision. Authenticated API responses use `private, no-store`; persist permitted data explicitly in the app's encrypted database.

## Business setup, catalogue and sync

Owners configure `PUT /settings/document-profile`, `POST /settings/activate-non-gst`, and `POST /settings/document-series` before billing. The series body is `{financialYear:"2026-27",lastNumber:0,operationId:<uuid>}` for a genuinely new business. An existing business must provide its actual last used number. A series cannot be reset after issuance. `GET /settings/document-series` returns current counters. Each new financial year requires confirmation of its series.

| Method and path                                                                              | Access                                                                                                                 |
| -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `GET /catalogue`, `GET /customers`                                                           | Owners and staff; convenience lists are bounded.                                                                       |
| `GET /sync?cursor=0`                                                                         | Owners and staff; authoritative initial download and subsequent incremental pull. Follow `nextCursor` while `hasMore`. |
| `PUT /catalogue/items/:itemId`                                                               | Owner; expected version and operation ID required. Saved revisions stay available for old bills.                       |
| `PUT /customers/:customerId`                                                                 | Owners and staff; expected version and operation ID required.                                                          |
| `GET /catalogue/import-template`, `POST /catalogue/import-preview`, `POST /catalogue/import` | Owner CSV workflow.                                                                                                    |

Apply each sync page and cursor in one SQLite transaction. On `catalogue.item`, replace that item's local row and its unit rows, including `priceMinor`, conversion `factor`, version and active flags. Commit before showing a price-change notice. Existing bill snapshots keep their old values. Owner-only balance and quotation changes are omitted for staff while the cursor still advances. Staff bill sync contains delivery information and quantity permissions, without bill prices or customer balances.

Pull at startup, resume, reconnect and manual retry. Use tombstones (`active:false`). On membership removal, preserve the unsent outbox for signed recovery and purge inaccessible cached business records. The Flutter app must enforce the seven-day offline lease and secure local unlock.

## Bills, payments and advances

`POST /bills` accepts `id`, nullable `customerId`, optional `quotationId`, `occurrenceAt`, `operationId`, `lines` and `payments`. A line contains `id,itemId,unitId,catalogueVersion,quantityMilli` and an optional owner-only `overridePriceMinor`. A payment contains `id,method,amountMinor`; methods are `cash`, `upi`, `bank`. Cash is confirmed immediately; digital components require owner verification. Staff components cannot exceed the sale. Walk-in sales require full confirmed cash coverage at creation.

`GET /bills/:billId` allows owners or the bill's original staff actor. Invoice numbers follow server acceptance in the business/year series. Valid historical catalogue prices are retained. Owner projections record `catalogue_stale`, `stale_price` and the catalogue/price seen at issuance; staleness alone does not require credit approval. Older rows may have null flags because that information was not captured.

| Method and path                       | Owner body                                                                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /payments/:paymentId/decision`  | `paymentId,confirm,operationId`                                                                                                                                |
| `POST /bills/:billId/credit-decision` | `billId,approve,operationId`; an owner may explicitly release an issued saved-customer bill on credit.                                                         |
| `GET /customers/:customerId/balance`  | Returns debt and available advance.                                                                                                                            |
| `POST /opening-balances`              | `customerId,kind` (`debt`/`advance`), `amountMinor,note,operationId`                                                                                           |
| `POST /repayments`                    | `customerId,amountMinor,note,operationId`; confirmed cash, reducing overall debt then creating advance.                                                        |
| `POST /advance-applications`          | `customerId,billId,amountMinor,operationId`; limited by available advance, current adjusted bill due and debt.                                                 |
| `POST /ledger-corrections`            | `entryId` (string), `reason,operationId`, optional `replacement:{amountMinor,openingKind?}`; `openingKind` is required only when replacing an opening balance. |
| `POST /payment-corrections`           | `id,paymentId,reason,operationId`, optional `replacement:{id,method,amountMinor,occurrenceAt}`                                                                 |
| `POST /delivery-corrections`          | `id,deliveryId,reason,operationId`; reverses the original event and cannot erase goods already returned.                                                       |

Opening balances and repayments return `entryId` for later correction. Original entries remain; correction adds a reversal and optional replacement. An adjustment that would make debt or advance negative is refused.

Opening balances and cash repayments also accept an optional ISO `occurrenceAt`. Ledger history keeps it separately from server receipt time. A correction replacement may override that date; otherwise it retains the original occurrence date. Overview periods use server acceptance/receipt time, so an uploaded old event is visible in the period in which the server accepted it.

## Delivery permissions

`GET /delivery/:billId` returns billed, delivered, returned, cancelled, pending and excess canonical quantities, delivery history and a safe `authorization` with a `revision`, `ownerCreditRelease` and per-line `permittedAdditionalCanonical`/`maximumCumulativeCanonical`.

`POST /delivery` accepts `id,billId,lineId,unitId,quantityMilli,occurrenceAt,operationId` and optional `authorizationRevision`. Save that revision with offline work. A staff event counts toward delivery immediately, with owner review through `POST /delivery/:id/review` (`id,accept,operationId`). Rejection opens a dispute and does not erase the handover.

Coverage calculation: original line prices and saved conversions value quantities. Confirmed bill receipts plus applied advance, less funds credited as advance or refunded, fund delivery. Net retained deliveries consume coverage. Remaining covered money is allocated to pending lines in stable line-ID order, rounding each consumed paise upward and allowed quantities downward to nine decimal places. Pending or rejected digital claims supply no coverage. Ordinary unpaid saved-customer sales may be delivered; an unverified digital claim requires confirmed coverage or explicit owner credit release. Returned quantities do not become pending delivery again.

Overlapping work recorded against a valid older saved authorization is retained with `coverageConflict:true` and `state:"disputed"`. Invalid or missing coverage without a valid saved authorization is refused. Distinct excess handovers are never clamped or silently discarded.

## Returns and cancellation

Owner `POST /returns` body: `id,billId,lineId,quantityMilli,disposition,reason,resolution,operationId`, optional `unitId`, and refund fields when applicable. `disposition` is `restockable`, `damaged` or `discarded` for history. Omitted `unitId` means the billed unit; another unit must exist in the bill's original saved catalogue revision.

Owner `POST /bills/:billId/cancel` body: `billId,reason,operationId`, optional `lines:[{lineId,unitId?,quantityMilli}]`, settlement fields. Without lines it cancels the undelivered remainder. Delivered quantities must use returns. Full undelivered cancellation marks the bill cancelled; partial cancellation preserves its issued original.

Both use the original bill value, cumulative quantity/value limits and one transaction. Debt is reduced first. If value remains, choose **all** `refund` or **all** `advance`; split settlement is unsupported. Refund requires `refundId` and `refundMethod` (`cash`/`upi`/`bank`). Pending digital claims remain available for separate owner verification after cancellation.

## Staff requests and revoked work

Staff `POST /requests`: `id,type,targetId,payload,reason,operationId`. Types:

- `bill_cancel`: target bill; payload `{}` or `{lines:[...]}`.
- `return`: target bill; payload `{lineId,unitId?,quantityMilli,disposition}`.
- `delivery_correct`: target delivery; payload `{}`.

`GET /requests` returns own requests to staff and all requests to owners. Owner `POST /requests/:id/decision` accepts `id,approve,reason,operationId`; approved returns and paid cancellations also need `action:{resolution,refundMethod?}`. Approval performs the action atomically; rejected requests cause no financial event.

Revoked devices use unauthenticated `POST /v1/recovery/upload` with `{deviceId,businessId,operationId,payloadType,payload,signature}`. Sign the canonical sorted JSON of all fields except `signature` with the enrolled Ed25519 key. The signature is base64url; claimed device timestamps do not prove prior permission.

Owner `GET /quarantine` and `POST /quarantine/:deviceId/:operationId/decision` (`accept,reason,decisionOperationId`) control acceptance. Bills, deliveries and staff requests reuse their normal payload schemas. `payment` is specifically an original-owner cash repayment payload; `return` is an original-owner return payload. Staff returns use `request`. Payload `operationId` must match the upload. Review keeps the original actor and separately audits the reviewing owner. Unsupported historical payloads or missing role snapshots remain manual reconciliation cases. The `/review` route is a legacy note only.

## Documents, quotations and reports

- Owner `GET /bills/:billId/pdf?showPayments=true&showPriorDebt=true` controls presentation. Prior balances use the issuance snapshot; current overall debt is separately timestamped. Options do not alter ledgers.
- Owner `GET /bills/:billId/adjustments/pdf` lists preserved returns, refunds, payment corrections and cancellations.
- Owner `POST /quotations`, `GET /quotations?after=<uuid>`, `GET /quotations/:id`, `GET /quotations/:id/pdf`, `GET /quotations/:id/draft`. Draft copy retains quoted prices, flags current catalogue differences, and has no financial effect. A quotation can produce only one confirmed bill.
- Owner `POST /composition/preview` is a draft only and creates no invoice number or ledger entry. Accountant samples are not an activation prerequisite.
- Owner `GET /reports/overview?from=<ISO>&to=<ISO>` returns one consistent database snapshot. Receipt totals include original receipts and standalone repayments; subtract `receiptReversals` and refunds to interpret net collections. Advance application and opening balances are not new collections.
- Owner `GET /reports/fulfilment?after=<uuid>` pages quantities by original line; quantities from unrelated canonical units are not summed together.
- Owner `GET /reports/customers/:customerId/history?after=<ledgerId>` pages the explanatory ledger. Reports state that unknown unsynced phone work is excluded.

## Notifications and conflicts

An owner app registers an FCM token through `PUT /v1/devices/:deviceId/push-token` with `{token}` and unregisters using `DELETE` at that path. The authenticated session must belong to that device. Generic approval notices contain a business/reference/category, without financial details. Fetch the referenced record after authenticating. Catalogue changes update SQLite at sync and use an in-app notice.

Delivery is retried through the durable queue; the app can deduplicate notices by business, category and reference. The server uses Google's authentication library and the FCM HTTP v1 API, without Firestore or Storage SDK dependencies.

On a saved workflow conflict, `409` includes `outcome:"review_required"` and `conflictId`. Owner `GET /conflicts` and `POST /conflicts/:id/resolve` accept `resolution` (`discarded`, `retry_after_sync`, `superseded`), `note`, decision `operationId`, and a recorded `replacementOperationId` for superseding. Changed financial payloads need a new operation ID. Device-time last-write-wins is never used for money or quantities.

Treat `400` as invalid input, `401` as requiring sign-in/refresh, `403` as access removal, `409` as a workflow/version decision, `429` as delayed retry using `Retry-After`, and `503` as a retryable service condition. Never discard an unsent financial record solely because one upload failed.

Owner document setup: `GET /businesses/:businessId/settings/document-profile` returns `{profile,version,mode}` for the existing version-checked profile PUT. Staff are denied. Delivery lines now include `item_id`, `unit_id`, `catalogue_version` and original `units` containing only IDs, labels and factors, so staff can record mixed-unit handovers without receiving financial fields.

## Separate administrator website

The framework-free administrator website is served by the same backend at `/admin/`. It is a setup surface for businesses, accounts, memberships and devices; admin status does not grant access to operational or financial business routes. The API is session-cookie based and separate from the Flutter bearer-token contract.

`ADMIN_WEB_ORIGIN` must be set to the exact public origin serving the website (scheme and host, with no path). The server checks exact `Origin` on state-changing browser requests. Login requires `X-Requested-With: BillEaseAdmin`; authenticated state-changing requests also require `X-CSRF-Token` from the session response. The session cookie is opaque, `HttpOnly`, `SameSite=Strict`, and scoped to `/admin`; access/refresh state stays encrypted server-side. Sessions expire after 30 minutes idle or 8 hours absolute, whichever comes first. Admin accounts must complete MFA at login.

The website contract is `GET /admin/api/session`, `POST /admin/api/login`, `POST /admin/api/logout`, `GET /admin/api/directory`, and scoped setup endpoints under `/admin/api/businesses`, `/admin/api/users`, `/admin/api/memberships`, `/admin/api/devices`, and `/admin/api/mfa`. The directory returns businesses, users, memberships, devices and audit events. It never returns balances, bills or reports. Last-owner and role constraints remain enforced. Recovery-code rotation requires the password and a current MFA or unused recovery code. See `Frontend/Admin/README.md` for the browser workflow and local setup.

Owner-only `GET /v1/requests` includes `accessNotices`, with notices scoped to the requesting owner. These are in-app access notices; this feature does not add a push-notification category.


## GST contract update - 30 October 2026

- Admin business creation requires `documentMode: "composition" | "regular_gst"`. Historical non-GST data is preserved; public non-GST activation returns 409. Business listings include `documentMode` and supplier `stateCode`.
- Owner document profiles include legal supplier name/address/phone, GSTIN, state code and signatory. GSTIN checksum/state are validated before issuance.
- Catalogue items add `hsn` (4-8 digits), `gstRateBps` (integer basis points; 1800 = 18%) and `taxCategory: "taxable" | "nil_rated" | "exempt"`. Composition requires HSN only. Regular taxable items require a positive rate; nil/exempt require zero. Omitted fields preserve older metadata.
- Customer create/update adds optional `gstin`, `address`, `stateCode`. Registered recipients require their address/state. High-value unregistered sales require the prescribed recipient identity fields.
- Bills and quotations add explicit `placeOfSupply` (two-digit Indian state code) for GST businesses. All prices are inclusive. `document_snapshot.tax` freezes original per-line HSN, categories/rates, taxable value, CGST/SGST or IGST components, totals and document type.
- Document types are `tax_invoice`, `bill_of_supply` and supported unregistered `invoice_cum_bill_of_supply`. Regular exempt Bills of Supply do not acquire composition declarations. Intraterritory UTGST, cess, export-specific and registered mixed taxable/exempt cases are unsupported.
- Quotation PDFs show estimates only; conversion revalidates current catalogue revision and retains the quoted price override with owner-visible change warnings.
- Returns/cancellations freeze original operational `taxSnapshot` / `taxSnapshots`. Cumulative allocation prevents over-reversing a paisa across mixed partial adjustments. Debt-first all-refund/all-advance settlement is unchanged.
- Owner `GET /reports/gst?from=<ISO-offset>&to=<ISO-offset>` returns original/reversed/net integer-string `{baseMinor,cgstMinor,sgstMinor,igstMinor,grossMinor}` totals, grouped modes/tax types and separately counted legacy totals. Original sales use issuance dates; reversals use recording dates. This is an operational report, not a statutory filing.
- New layouts are `reference-invoice-v1` and `reference-quotation-v1`. Known historical revisions use their legacy renderer; unknown revisions return 409 before PDF headers. PDFs use saved tax data and separate component rate columns. Government e-invoicing is excluded.
