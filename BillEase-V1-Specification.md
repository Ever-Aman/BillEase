# BillEase — Revised V1 Specification

Date: 30 October 2026  
Owner: Aman Gupta  
Status: Requirements updated with Aman's 30 October decisions. Implementation and verification evidence are tracked in Backend/IMPLEMENTATION_STATUS.md and Frontend/IMPLEMENTATION_STATUS.md.

## 1. Purpose and boundaries

BillEase is a personal tool for approximately 3–4 separate businesses, normally operated by their owners with up to 3–4 people creating bills per business. Android phones and tablets are the operating devices. A Windows Chrome interface supports administrative setup and access management.

V1 covers item catalogues, quotations, billing, customer debt and advances, payment records, and delivery tracking. It tolerates intermittent internet without losing locally saved work. It does not manage physical inventory or purchasing.

Success means a bill, payment, or delivery is recorded once; customer balances remain explainable; an issued document can be reproduced; and staff cannot access owner-only financial information.

### Included

- Multiple separate businesses, multiple equal owners per business, and one-business staff accounts.
- Item units, conversion factors, independent selling-unit prices, and owner-controlled tax configuration.
- Named and walk-in bills; split payments; overall customer debt; advances; opening balances.
- Owner quotations and conversion to draft bills.
- Offline local recording and reliable synchronization.
- One server-assigned consecutive invoice-number series per business, with financial-year handling.
- Owner-only A4 PDF preview, saving, and sharing.
- Partial deliveries, mixed-unit delivery/returns, offline delivery entries, and owner review.
- Auditable corrections, returns, cancellations, and payment verification.
- Security, backups, restoration, and operational error visibility.

### Explicitly excluded

- Stock quantities, reservations, net/available stock, shortage checks, stock adjustments, and expiry/batch management.
- Purchase entry or imports, supplier accounting, supplier balances/payments/returns, and supplier invoice attachments.
- Accountant purchase exports, GST sales exports, direct tax filing, and automatic input-tax-credit decisions.
- Direct printer integration, automatic WhatsApp/SMS sending, and cash-handover reconciliation.
- Interstate sales in the initial operating scope.
- Profit accounting, business expenses, and a complete accounting system.

Removing stock management does not remove item-level billed/delivered/pending quantities. These represent customer fulfilment, not physical stock.

## 2. Chosen approach and alternatives

The discussion selected an offline-capable Android application with a local database and a central server. Local writes and a persistent upload queue support outages. The server assigns final invoice numbers, checks permissions, and handles shared financial operations.

Alternatives considered:

1. Fully online billing is simpler but cannot meet the requirement to save bills and payments during outages.
2. Independent device invoice series support immediate final offline documents but were rejected because all devices must share one consecutive series.
3. The selected compromise permits offline recording but blocks final PDF generation, download, and sharing until upload and server numbering. There is no customer-facing provisional receipt in V1.

The original Flutter/Drift, Node.js/Express, and PostgreSQL stack remains the starting point. Hosting vendors and current plans are implementation choices, not assumptions that a free plan meets durability or availability needs. Do not add a distributed services architecture for this scale.

## 3. Identities, access, and screens

Model users separately from business memberships. A business membership records user, business, owner/staff role, active state, and applicable optional capabilities. One owner can have multiple owner memberships; a business can have multiple equal owners. Enforce the rule that a staff account belongs to exactly one business. V1 does not require mixed owner/staff roles for the same account across businesses.

Admin manages business setup, accounts, owner assignments, and access. Admin status alone grants no access to operational financial endpoints. Admin account changes and membership changes are audited and affected owners notified. An application permission boundary is not a guarantee against a database operator or compromised infrastructure administrator.

Owners have equal authority within an assigned business: billing, prices, credit, advances, corrections, approvals, quotations, sharing, and reports. An owner can perform an allowed operational action directly without approving their own request. Another owner can review or correct it, preserving history.

Staff use the same screen family with unavailable actions hidden. Hiding is supplementary; API authorization remains authoritative.

| Action or data | Staff | Owner | Admin-only account |
|---|---|---|---|
| Create bills from existing items | Yes | Yes | No |
| Catalogue creation, prices, conversions, tax configuration | No | Yes | No |
| Current-bill price override or discount | No | Yes | No |
| Record cash/current-sale payment claims | Yes | Yes | No |
| Verify UPI/bank receipts | No | Yes | No |
| Create an underpaid named-customer sale | Submit for review | Direct | No |
| Existing customer debt, advances, opening balances | Never | Yes | No |
| Standalone repayment, advance application, payment correction | No | Yes | No |
| Other people's bills | Delivery-safe projection only | Full business access | No |
| Record actual handover | Yes, later owner review | Direct | No |
| Bill correction, cancellation, return, refund | Request | Approve/direct | No |
| Create/share quotation; export/share bill PDF | No | Yes | No |
| Financial reports | No | Yes | No |
| Setup and access assignments | No | No admin powers by owner role | Yes |

For another person's bill, staff receive customer identification/contact needed for delivery, item descriptions, selling/delivery units, quantities, and fulfilment status. Exclude prices, totals, payment records, debt, and advances. Staff can view financial details of the current bills they create to collect payment, but never historical customer balances. Owner configurable staff capabilities cannot override these hard restrictions. Purchase-cost permissions discussed earlier disappeared when purchasing was removed.

Do not download owner-only records to staff devices and merely hide them. Local schema and synchronization projections differ by role; they do not mirror every server table.

## 4. Item catalogue and quantities

Owners maintain items and selling-unit definitions. Each unit has a conversion factor to a canonical item unit and an independently configured selling price. For example, one box may equal 12 pieces while costing less than 12 individual pieces.

Repeated entries of the same item and selling unit on one bill use one price; merge quantities or apply one shared price consistently. Different units may have different configured prices. An owner override affects only that bill's item/unit price, not the catalogue. Capture the override actor and price difference.

Staff can only use previously synchronized catalogue definitions. If an offline staff bill uses an older valid price revision, keep the historical price and flag the difference on upload; do not automatically reprice or require approval solely for staleness. The server validates the referenced historical catalogue revision so arbitrary staff-submitted prices are not accepted as a claimed stale price.

Retain the original owner-only catalogue CSV import, with a downloadable template, preview, row validation, and duplicate detection. It imports item/unit/price definitions only, never stock or purchases. Excel catalogue import was not agreed and is not required for V1. Existing catalogue revisions used by old bills cannot be overwritten by an import.

Save descriptions, unit labels, conversion factors, price/tax treatment, and relevant HSN details on bill lines. Historical quantities and PDFs cannot depend on subsequently edited catalogue entries. Changes to canonical units must not reinterpret old delivery events.

Use decimal quantities with per-unit precision rules. Never use binary floating point for financial totals. The exact database precision and rounding algorithm are builder decisions to document and test.

## 5. Customers and financial ledger

Saved customers require name, phone number, and locality. Phone numbers support search but are not proof of identity or automatically unique people; flag possible duplicates rather than silently merging family/shared-number accounts. Customer records and balances remain business-specific.

Walk-in bills do not require a saved customer but cannot carry credit, advances, or a credit-delivery exception. A saved customer with the three required fields is eligible for an owner's credit decision; there is no separate identity-verification workflow.

Record individual financial events and derive balances. Do not keep only a manually editable aggregate balance or invoice amount-paid field.

Separate:

- Customer debt: outstanding amounts owed to this business.
- Available customer advance: funds held for later use or refund.

These can coexist because applying advances is an explicit owner decision. Do not automatically net unused advances against new credit sales.

Owner-only opening balance entries can represent existing debt or advance, with date, note, actor, and correction history. They are not new sales or newly collected payments.

### Payment and debt rules

- Each cash, UPI, or bank-transfer component is a separate payment entry with amount, method, recorder, business/customer/bill reference as appropriate, occurrence time, server receipt time, and verification state.
- A confirmed payment collected during a sale first covers that sale; confirmed excess reduces older overall customer debt, then becomes an advance if any excess remains. This is a proposed accounting convention implementing the agreed overall-balance model, not allocation to individual older bills.
- A standalone owner-recorded repayment reduces overall debt; confirmed excess becomes an advance.
- Owners explicitly choose advance usage up to the smaller of available advance and remaining current-bill payable amount. Apply online in one transaction. Unused advance stays available.
- Applying an existing advance is not a new cash collection and must not inflate collection reports.
- Staff-recorded cash is confirmed immediately. Staff-recorded UPI/bank entries remain pending until owner verification; pending claims do not reduce confirmed debt or increase available advances.
- Proposed enforcement of the agreed owner-only balance rule: staff-entered payment components cannot collectively exceed their current bill's unpaid value, accounting for both existing confirmed components and outstanding claims. An owner handles excess receipts, older-debt repayments, or advances. This prevents staff from indirectly performing owner-only transactions through an overpayment.
- Owners can mark payments they have verified as confirmed. A receipt rejected as not received remains in history and never becomes a confirmed payment.
- Only owners correct payment entries. Preserve the original and record a reversal/replacement or equivalent append-only correction with a reason.
- Staff report payment-entry mistakes outside the app; V1 does not add a staff payment-correction request workflow.
- No bad-debt write-off feature: debt persists until payment or an approved sale adjustment/return changes it.

Example: opening debt ₹1,000, new sale ₹500, confirmed receipt ₹700 produces debt ₹800. Hiding previous debt in the PDF does not change the calculation. Confirmed customer receipts are recorded once regardless of document layout.

Approval disputes must not erase a real sale, delivered goods, or received money. Keep disputed records visible to owners until properly resolved.

## 6. Bills, taxation, and official documents

A bill has independent dimensions rather than one overloaded status:

| Dimension | Illustrative states |
|---|---|
| Lifecycle | Draft, issued, cancelled/adjusted |
| Synchronization | Local pending, uploading, server accepted, failed/review required |
| Review | Not required, credit review pending, approved, disputed |
| Payment | Confirmed paid, underpaid, digital verification pending; derived from entries |
| Fulfilment | Not delivered, partial, delivered, discrepancy |

Saving an offline completed sale creates a stable local record, captures actual payments, and shows a pending-upload icon. It does not create a shareable provisional document. Drafts do not enter sales or debt; a locally confirmed sale does, in the device's provisional owner view, and enters server records once accepted. Display the difference between local provisional data and synchronized reports.

The server assigns the final invoice number after accepting the uploaded sale. Use one shared, transactionally allocated series per business and applicable financial year, with no device-specific numbering. Assignment order follows server acceptance, not potentially incorrect device clocks. Rejected requests do not receive final numbers; issued/cancelled numbers are never reused or silently renumbered. Keep immutable creation/occurrence times separately from official issuance time and numbering. Late/offline period-boundary documents require explicit owner review before official issuance; the accounting treatment must be verified with the accountant.

Do not consume invoice numbers through a nontransactional sequence if rollback would violate the required strict consecutive allocation. Serialize allocation per business/series and commit it with issuance. Cancelled documents remain visible in the series.

### GST boundary

Admin selects Composition GST or Regular GST at business creation; new non-GST onboarding is excluded while historical records remain supported. Owners set legal identity, GSTIN/state and item HSN/rates. Selling prices are inclusive. Supported domestic intra-State CGST/SGST and inter-State IGST transactions preserve taxable value and separate component rates/amounts in immutable snapshots.

Composition supplies use Bills of Supply; regular taxable supplies use tax invoices. Supported exempt/nil-rated and mixed supplies use their applicable document type. Accountant-provided samples or approval are not a project prerequisite; required legal/item/transaction fields still gate issuance. Government e-invoicing is out of scope. Unsupported intraterritory UTGST, cess, export-specific and registered mixed taxable/exempt cases must fail clearly rather than produce guessed documents.

Tax percentages and treatments are explicit owner configuration; no automatic 18% default for unknown items. Tax-inclusive calculations, discounts, rounding, zero-rated/exempt distinctions where needed, and correction documents require agreed sample cases before implementation. Reverse-charge or other unsupported transaction types must not be silently billed as ordinary local sales.

### A4 PDF preview and sharing

- Owner-only generation, saving, and sharing. Staff have no PDF endpoint access.
- Require accepted upload and final number. Staff-created underpaid sales also require owner credit approval.
- Pending digital receipts require verification or explicit approval to present the sale on credit.
- Owner preview controls include showing current payment details and showing prior outstanding debt. These are document presentation controls, not additional sales, tax, payment, or debt entries.
- If included, distinguish current sale, previous debt, payment received, and remaining debt. Never tax or duplicate old debt.
- An issued invoice with hidden payment details remains an invoice; it is not relabelled as a quotation.
- Snapshot supplier identity/address/GST data, customer details, line data, tax calculations, and document-layout revision so past documents reproduce faithfully.
- Shared PDF copies cannot be revoked after recipients save them. Keep generated files out of public permanent URLs and delete temporary app copies according to the selected retention policy.

## 7. Quotations

Only owners create and share quotations. They have their own references, clearly labelled as quotations, and no sales/debt/advance/delivery effects.

An owner can copy a quotation into a draft bill and review it before confirmation. Copy quoted prices, flag differences against current catalogue values, retain the source quotation link, and prevent duplicate confirmation through stable IDs. Copying alone has no financial effect. A quotation is not an issued GST tax document.

## 8. Delivery without stock management

Track billed quantity, actual delivery events, and remaining obligation per bill line. Record quantities handed over now, never overwrite a cumulative total. Events carry a unique ID, bill-line reference, entered unit, saved conversion, actor, occurrence time, receipt time, and review state.

Different configured units can be used: bill two boxes and deliver six pieces, using the bill's preserved conversion definition. Physical availability is checked by the people in the shop, outside BillEase. No stock balance is consulted or changed.

Staff hand over goods and record delivery, then owners review. Therefore a staff event counts toward delivered quantities before review; it is not held out of fulfilment totals until approval. Owner-entered events need no approval. Rejection opens a correction/dispute and cannot imply goods magically returned. Owners correct with a reason, retaining the original event and any reversal/replacement.

Multiple people can record delivery, including offline. Sync preserves all genuine distinct events. If combined deliveries exceed billed quantity, retain the true total and show an excess/discrepancy flag for owner resolution; do not clamp the total, silently discard an event, or duplicate it on retry. Pending quantity may be displayed as zero with excess shown separately.

All-delivered selection: select remaining quantities across chosen bill lines, allow unticking and editing quantities, and confirm before recording. These are quantities visible to that device, not a promise that another offline device has not already delivered them. Use event IDs and flag merged excesses.

### Payment-related delivery gate

- Ordinary underpaid staff sales to saved customers may be delivered before owner credit review; retain the debt and review flag.
- A claimed UPI/bank payment is not confirmed money. Do not release goods on that claim unless confirmed payment is sufficient or an owner explicitly authorizes credit for a saved customer.
- Walk-in customers cannot use the credit exception.
- The same policy applies to partial deliveries; the system must compare the confirmed financial coverage with the original priced quantities being released. The builder must document the coverage calculation, including earlier deliveries, discounts, and mixed units.
- These are offline workflow controls, not a guarantee that disconnected staff have fresh payment information. Owners' online verified decisions can be cached; do not fabricate a verification when offline. Conflicting offline state is flagged for review on synchronization.

Privacy-preserving implementation proposal: do not send other people's bill values or payments to staff devices to calculate coverage. The server publishes a delivery-safe authorization containing permitted quantities per bill line, an authorization revision, and any owner release decision, without financial amounts. Staff record against cached authorized quantities offline. Newly created staff bills can compute their own local coverage from their permitted current-sale data, subject to the same rules. When a newly changed authorization is needed, synchronize first; an unavailable authorization is not proof of payment. Multiple devices may consume overlapping cached permissions during outages, so preserve and flag conflicts just as for over-delivery. Delivery-safe authorization is not a promise of exactly-once physical handover across disconnected people.

## 9. Requests, corrections, returns, and cancellations

Staff request financial corrections, cancellations, returns, and refunds; owners approve or perform them directly. Use specific request types and allowed fields rather than accepting arbitrary client-supplied record patches.

Draft bills remain editable. Issued documents are preserved. Corrections use a recorded adjustment, cancellation, or applicable GST credit/debit document; do not hard-delete issued invoices and cascade away their lines.

Undelivered cancellation reduces the bill's remaining fulfilment obligation after owner approval, with no physical stock effect. Resolve its financial value and any money already received through explicit balance/refund entries. Partial cancellation cannot silently cancel quantities already handed over.

Returns reference original bill lines and may use another saved unit conversion. Value them from the original bill price/discount/tax treatment, not today's catalogue price or another selling unit's current price. Record refund, debt reduction, advance creation, or a split that does not exceed the approved return value. For consistency, an owner cannot reduce debt below zero; any approved excess is explicitly refunded or credited as advance.

Classify returned items as restockable, damaged, or discarded for history only; there is no inventory movement in V1. Distinguish delivery history, returned quantity, and remaining obligation so a returned item is not automatically scheduled for redelivery. Replacement/exchange ordering is outside the agreed V1 feature set; an owner may create a separate linked sale if needed.

Verify cumulative return and refund limits against original eligible quantities/value. Owners review conflicts where concurrent offline requests exceed those limits; a rejected request never becomes an automatic refund.

## 10. Synchronization and persistence

Use stable client-generated entity IDs and operation IDs before the first local save. An operation represents one user intention, not one HTTP attempt.

Required local transaction: save the business event, line/payment children where applicable, and outbox record atomically. Required server transaction: authenticate/authorize, validate references, perform business changes, save audit/ledger events and idempotency result atomically. Long external operations must use explicit states, not pretend to be database-atomic.

Outbox records need operation ID, entity references, expected version, dependencies, payload revision, attempt count, next retry time, status, and last actionable error. Payloads stop changing after submission; a later correction is a new operation referencing the original.

Server pull uses an ordered server change cursor, never only client timestamps. Include role-appropriate records and tombstones/deactivations. Apply pull changes and cursor advancement together locally. Push dependencies in order or submit atomic aggregates: customers before dependent bills, accepted bills before deliveries, and approvals against existing requests. Keep mappings from local bill IDs to final numbers.

Provide retryable/permanent/review-required outcomes. One malformed operation does not indefinitely block unrelated operations. Use exponential backoff with jitter and server retry guidance. Mobile background sync is best effort; also run at app open/resume, reconnect, and explicit user retry. Show pending count, last sync, and failures without exposing forbidden values.

Master-data edits use expected-version checks. Financial events are append-only with corrections. Do not use device-time last-write-wins for money, permissions, or quantities. Distinct offline edits need owner-visible resolution, not one replaceable conflict snapshot.

Permission revocation takes effect on reconnect. Preserve unsynced records from revoked users and place them in owner quarantine; they receive no automatic official invoice number or financial acceptance. Permit a restricted upload-only recovery path bound to the previously enrolled device, with no read or new-work permissions, rate limits, and audit. Treat claimed device timestamps as untrusted. Accepted old work retains its original actor and reviewing owner.

## 11. Security requirements

### Idempotency, concurrency, and integrity

- Apply operation IDs to every create action and non-idempotent mutation: bills, payment components, deliveries, requests, approvals, returns, corrections, and advance usage.
- Scope IDs by business and operation type as appropriate. Persist the first request's canonical payload hash and durable entity reference; identical authorized retries return the recorded result.
- A reused key with different data is an error, not an update. Check current authorization before returning replayed sensitive data.
- Enforce uniqueness in PostgreSQL, including concurrent requests; a check-then-insert without a constraint is insufficient.
- Keep financial/event IDs unique for their full retained lifetime even if response caches expire. Do not assume a 24-hour deduplication cache covers offline replay.
- Disable repeated submit in the UI while saving, but do not rely on the button for correctness.
- Atomically serialize advance use, invoice allocation, and request approval. Use expected versions and ledger balance checks to prevent two owners spending the same advance.

### Transport, local data, and secrets

- HTTPS only, valid certificate verification, and no cleartext release endpoints; TLS for server-to-database connections.
- Verify database and backup encryption in the actual deployment plan. Encryption of transport is not storage encryption.
- Encrypt the local business database using a supported encrypted SQLite integration compatible with Drift. Store keys through Android Keystore-backed secure facilities; never hardcode a common encryption key or derive protection only from a short staff PIN. Verify this integration before schema implementation.
- Keep refresh credentials in secure storage, not ordinary preferences. Never put server database credentials, JWT signing keys, admin recovery secrets, or privileged service keys in the app.
- Hash passwords using a vetted password-hashing algorithm; hash PIN verifiers and enforce attempt delays. Do not sync server password hashes to phones.
- Do not invent application cryptography or promise that encryption prevents an authorized malicious user, an unlocked compromised phone, or a server compromise from changing data.

### Authentication, device enrolment, and MFA

- First-time sign-in and device enrolment require internet. Staff PIN unlock is for that already authorized personal device, not an unrestricted internet login based solely on a short PIN.
- Owner/admin remote sign-in uses a strong password. Owner local quick-unlock and inactivity timeout are builder defaults requiring secure device credentials; a proposed default is auto-lock after five minutes in background/inactivity.
- Admin requires authenticator-app MFA on new-device sign-in. Owners can enable it; staff use individual PINs on enrolled devices. Use vetted TOTP libraries, narrow clock tolerance, and prevent replay of accepted codes.
- Short access tokens and rotating refresh tokens with hashed server-side storage, device sessions, reuse detection, logout, and revocation. Validate signature, algorithm allowlist, issuer, audience, expiry, and token purpose.
- Offline authorization lasts seven days from the last successful server authorization, not the last app launch. Detect obvious clock rollback; reconnect rather than extending authorization indefinitely. A rooted/manipulated device remains a limitation of offline access.
- Block new work after the lease expires while preserving unsynced records. Reconnect supports authorization refresh and restricted recovery, not record deletion.

### Recovery decision and proposed mechanics

Admin recovery supports both one-time recovery codes and verified email. Apply the same protection to an owner who enables MFA.

- Generate high-entropy recovery codes, display once, store hashes, consume atomically, and rate-limit use. Replacing the code set invalidates old codes.
- Email must already be verified before it can initiate recovery. Recovery responses do not reveal account existence. Tokens are random, single-use, short-lived, hashed at rest, purpose-bound, and delivered without putting secrets in logs.
- An email link does not immediately disable MFA. Proposed default: initiate a 24-hour notified recovery hold, permit cancellation from an existing authenticated session, and after the hold require fresh email proof and password reset before MFA re-enrolment. If the email account is compromised, this recovery route is still a risk; protect that mailbox with MFA.
- Recovery completion revokes old sessions, refresh-token families, obsolete recovery tokens/codes, and old authenticator enrolment, then sends an alert. Do not silently grant new business memberships.
- Use a reputable transactional-email service and verify delivery/recovery in staging. Exact provider is a builder choice; email recovery must not be shipped as a nonfunctional placeholder.

The 24-hour hold, session timeout, password sign-in details, and recovery-token lifetime are proposed implementation defaults, not answers explicitly supplied by Aman. Review them before coding.

### Authorization and privacy

- Every endpoint checks active membership, role/capability, object business ownership, allowed fields, and valid workflow transitions; deny by default.
- Enforce same-business relationships through composite constraints or equivalent database integrity rules. Do not rely only on UUID unguessability or client-supplied business IDs.
- Business-scoped database queries and narrowly scoped service credentials. Admin setup endpoints and owner operational endpoints remain separate authorization policies.
- Do not accept client-provided approval, verified-payment, actor, or server timestamp fields as authority.
- Never return owner-only balances to staff, including in sync, exports, search, logs, notifications, or delivery projections. On role removal, purge inaccessible local data on reconnect while preserving quarantined unsynced work safely. Already viewed/exported data cannot be revoked retrospectively.
- Admin browser sessions use secure HttpOnly cookies where applicable, SameSite policy, CSRF controls, restrictive CORS, output escaping, and a content-security policy. CORS is not authentication.

### Abuse prevention and service hardening

- Separate rate limits for authentication/recovery, token refresh, mutations, sync batches, and PDF/export generation. Combine account/device and IP signals; do not lock out a whole shop merely because staff share an IP.
- Shared persistent limit state for authentication abuse across restarts or multiple instances. Use bounded request bodies, batch sizes, pagination, query timeouts, and reasonable connection limits.
- Parameterized SQL, strict schema validation, field allowlists, supported content types, no arbitrary URLs/files, and safe error responses without stack traces.
- Protect against spreadsheet formula injection if later CSV exports are introduced. No file upload endpoint is required for the removed purchase-attachment feature.
- Environment-based secrets, secret scanning, dependency lockfiles and updates, least-privilege database accounts, staging/production separation, and logs that exclude tokens/PINs/recovery material.
- Application audit events include actor/device, business, operation ID, server time, claimed occurrence time, original/replacement references, and correction reason. Staff and owner operational APIs cannot edit history. Ordinary application audit logging is not cryptographically tamper-proof against a database administrator.

## 12. Reports and operational visibility

Owner-only reports:

- Sales and adjustments by date, with current lifecycle/review status.
- Confirmed receipts/refunds by date and method, separated from unverified claims.
- Customer debt, available advances, opening balances, repayments, and explanatory history.
- Billed/delivered/returned/pending quantities, over-delivery discrepancies, and requests awaiting review.
- Pending uploads, rejected/quarantined operations, and stale devices affecting report completeness.

No stock, purchase, supplier, or accountant tax exports in V1. Owners can see each assigned business; default to explicit business selection. Any later combined view must preserve business identity and never merge customer balances.

Server reports state an as-of time and indicate that unknown unsynced activity on disconnected devices is excluded. The server cannot know the exact number of unsent records on a lost/offline phone. Show last device contact rather than claiming all records are synchronized.

## 13. Conceptual data model

This is a design map, not migration-ready SQL. UUIDs are generated locally for offline-created entities. Monetary fields use exact decimal or integer minor units; quantities use exact decimals.

| Entity | Purpose and integrity |
|---|---|
| businesses, business_document_settings | Separate identity, tax mode, document/series configuration and revision history |
| users, memberships, staff_capabilities | Authentication identity, multiple owner memberships, one-business staff restriction |
| devices, sessions, offline_authorizations | Enrollment, token families, last authorization, lease/revocation |
| mfa_enrolments, recovery_codes, recovery_requests | MFA and protected recovery lifecycle |
| items, item_units, catalogue_revisions | Canonical units, conversions, prices, historical staff price validation |
| customers | Business-specific mandatory name/phone/locality and deactivation |
| bills, bill_lines, document_snapshots | Sale state, original identity/line/tax snapshots and quotation source |
| document_series | Transactional per-business/financial-year number allocation |
| payments, payment_components, payment_reviews | Confirmed and claimed receipts, methods, verification, corrections |
| customer_ledger, advance_applications | Explainable debt and advances; no automatic cross-business netting |
| quotations, quotation_lines | Nonfinancial proposals and copy-to-bill linkage |
| delivery_events, delivery_corrections | Incremental mixed-unit handovers, reviewer and preserved history |
| requests, decisions, returns, adjustments | Typed approvals, original references, bounded return/refund value |
| audit_events | Server-attributed operational history |
| operations, change_log | Durable deduplication, payload hash, result reference, pull cursor |
| local_outbox, local_sync_state | Device-only persistent queue, dependency and retry/error tracking |

Never keep only invoices.amount_paid or a mutable customer.balance as the complete financial record. Aggregates are derived or transactionally maintained caches that can be reconciled to ledger events. No inventory or purchasing entities belong in the V1 schema.

## 14. Backups, restoration, and limits

Proposed deployment baseline: daily encrypted database backups, retained independently of the live database, with a target recovery point of 24 hours for server-accepted records. More frequent point-in-time recovery can improve this if the selected hosting plan supports it; verify rather than assume. Proposed restore-time target is one working day for this personal project.

Before live use, restore to an isolated database and a fresh enrolled Android device; reconcile sample bills, balances, pending deliveries, document numbering, and audit history. Prevent restored stale server state from replaying already accepted operations into duplicate money movements. Document recovery of signing/encryption keys and email/MFA recovery separately from database bytes.

Local-only records on a lost, destroyed, or uninstalled phone cannot be recovered from server backups. V1 tolerates up to seven days offline but does not promise zero data loss for an unsynced device. Warn owners about prolonged pending uploads and reconcile before uninstall/reset. No logging system or synchronization flag changes that limitation.

Database migrations must preserve pending queues, encrypted database access, historical snapshots, and financial integrity. Test upgrades with unsynced records and rollback/recovery paths. Do not deploy schema changes that older still-authorized clients can interpret incorrectly without a compatibility policy.

## 15. Verification required before live use

| Scenario | Required result |
|---|---|
| Double tap, simultaneous same-operation requests, timeout after server commit | One business event and original result on authorized replay |
| Retry after more than seven days or after idempotency cache cleanup | Existing stable event cannot be duplicated |
| Same operation ID with changed payload | Explicit rejection, no second effect |
| App crash during local sale save | Entire sale/outbox saved or neither saved |
| Server crash during issuance/payment | Transaction remains consistent; no orphaned money or duplicate number |
| Two owners apply the same advance | Only available funds can be spent |
| Staff alters price/approval/verified fields or business ID | Server rejects unauthorized manipulation |
| Staff opens another person's bill or sync response | Delivery-safe fields only; no financial leak |
| Offline price becomes stale | Original validated revision retained; owner flag shown |
| Pending digital payment and proposed delivery | Correct block or explicit saved-customer owner credit exception |
| Two offline staff record overlapping deliveries | Genuine events preserved; excess flagged, retries deduplicated |
| Catalogue conversion or supplier address changes | Old document/quantity interpretation unchanged |
| Partial return/cancellation and refund | Original quantity/value limits, history, debt and delivery consistent |
| Customer debt plus unused advance | Separate balances until owner explicitly applies advance |
| Seven-day lease expires or device clock rolls backward | New offline work blocked without deleting unsynced records |
| Revoked device reconnects with genuine old work | Quarantine-only upload, no business read access or automatic acceptance |
| PIN guessing, login/recovery abuse, expired/replayed tokens | Throttling and verification without exposing account existence |
| Admin/optional-owner MFA recovery | One-use codes or controlled email recovery; notifications and old-session revocation |
| Unauthorized PDF URL or staff export request | Denied; authorized PDF reproduces original document |
| Backup restored on a fresh environment | Balances and retained records reconcile; credentials/keys recover correctly |

Verification commands and current results are recorded in the backend/frontend implementation status files.

## 16. Remaining confirmations and builder responsibility

Business classification and legal details are entered by the admin and owners respectively. Accountant-provided samples are not required. Hosted configuration, actual owner data, physical-device acceptance and production backup/signing setup remain external readiness steps, tracked in USER_INPUTS_NEEDED.md.

Proposed defaults to review: recovery hold, auto-lock duration, recovery-token lifetimes, server backup/restore targets, payment-excess convention and staff overpayment cap, delivery-safe authorizations, and partial-delivery financial coverage calculation. These proposals resolve the privacy and financial-boundary cases identified during the builder check; they are not additional user answers. The builder may choose libraries, API naming, schema precision, batching/rate-limit values, validation structure, and hosting details provided the requirements and threat boundaries above are preserved. Verify current library and hosting documentation during implementation; this specification does not guarantee compatibility or provider pricing.

No architecture should claim instant offline revocation, absolute tamper protection, complete server reports from disconnected phones, or recoverability of never-uploaded records.

## 17. Reference material

Technical reference pages consulted during requirements review; verify their current versions during implementation:

- OWASP REST Security: https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html
- OWASP Authentication: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP access-control checks: https://devguide.owasp.org/en/04-design/02-web-app-checklist/07-access-controls/
- CBIC Rule 46, tax invoice particulars: https://taxinformation.cbic.gov.in/content-page/explore-rules/1000136/1000001
- CBIC Rule 53, credit/debit and revised document particulars: https://taxinformation.cbic.gov.in/content-page/explore-rules/1000144/1000001

This document describes the agreed application scope and proposed technical controls. It does not certify tax compliance or implemented security.
