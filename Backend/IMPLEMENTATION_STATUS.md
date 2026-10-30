# Backend implementation status

Current phase: development. Node.js 24, Express and PostgreSQL. Runtime configuration, application wiring, routes, services and utilities are separated. The full Flutter contract is in [API.md](API.md).

## GST completion verification - 30 October 2026

- Full isolated backend runner: 33 files / 51 test cases passed with migrations 001-030 and an inherited deliberately unusable pooled URL. A separate deployment-packaging file added afterward passed 2 tests; 34 backend test files are now present.
- Issued composition and regular GST PDFs and quotations passed actual service-to-PDF extraction tests, with saved legal/tax values unchanged after live profile edits. Legacy layout reproduction and unknown-revision rejection passed.
- Seven renderer tests cover separate CGST/SGST rates, IGST, exact large monetary values, Indian date handling, composition declaration placement and long-description pagination. The reference and stress samples were rendered and visually inspected.
- Return/cancellation regressions passed; independent review exercised 759,024 cumulative reversal cases without an allocation mismatch.
- Flutter: 63 tests passed, one expected standalone HTTP-test skip; the separate real Dart-to-Node-to-PostgreSQL smoke passed. Flutter analyze is clean. Admin model tests and browser smoke passed.
- Development Neon migrations 001-030 applied; actual runtime health and admin HTML/script/font requests returned 200 through the pooled connection.
- Root Docker/Railway packaging includes the separate admin site's required assets and excludes environment secrets. Docker is not installed locally, so no container-image build or hosted acceptance is claimed.

## Earlier verification on 29 October 2026

- All 24 test files passed on Node 24.22.2, each using a separate temporary PostgreSQL database with migrations 001–028. Verified with `TEST_DATABASE_URL='postgresql://neveraman@localhost/postgres?host=%2Fvar%2Frun%2Fpostgresql' npx --yes --package=node@24 node scripts/test.mjs` on 29 October 2026.
- HTTP roles, cross-business restrictions, revoked sessions, audit device identity and actual server startup/shutdown passed.
- Mixed-unit valuation, concurrent returns, partial cancellation, advance limits, correction replay, MFA/recovery and the concurrent MFA/sign-in regression passed.
- PDF text checks and an A4 visual inspection passed. Encrypted backup restoration to a different database passed.
- Clean dependency installation, source syntax, formatting and backup shell checks passed. Production dependency audit reported zero known vulnerabilities.

These checks use local PostgreSQL and a controlled FCM adapter test; they do not verify actual Firebase delivery or hosted Railway/Neon operation.

## Implemented

- Separate development/production configuration and database identity guard; bounded database pool, connection/query/lock timeouts, persistent rate limits and safe API errors.
- Admin business/user/membership/device setup, passwords, device enrolment, rotating refresh sessions, reuse detection, logout, personal device listing/revocation and logout-all.
- Separate `/admin/` browser website using an opaque HttpOnly SameSite Strict session cookie, encrypted server-side token state, 30-minute idle and 8-hour absolute expiry, mandatory admin MFA, and exact-Origin plus CSRF checks. It has no financial or operational privileges by virtue of admin status. Production must set `ADMIN_WEB_ORIGIN` to the exact backend-site origin.
- Authenticator MFA setup/confirmation for owners, mandatory admin MFA at login, one-use recovery codes and recovery-code rotation. Admin MFA cannot be disabled from the app. MFA enrolment and session issuance serialize on the user to prevent a concurrent sign-in bypass.
- Versioned catalogue/customer data, owner CSV import/preview, incremental role-aware sync, historical catalogue validation and stale-price flags at bill acceptance.
- Composition Bills of Supply and supported regular GST tax invoices with inclusive BigInt tax calculations, original legal/item/tax/layout snapshots, explicit place of supply and separate component rates. Existing non-GST records remain supported. New admin creation requires the registered business classification. Numbering, payment review and owner credit release remain transactional and idempotent.
- Customer debt/advance ledger, dated opening balances and cash repayments, bounded advance use and append-only opening/repayment/payment correction with optional replacement.
- Mixed-unit deliveries, safe quantity-only financial authorization, owner review, delivery reversals, concurrent offline handover disputes and excess quantities.
- Mixed-unit returns valued at original bill rates; cancellation of selected undelivered quantities or the entire remaining obligation. Debt is reduced first; the whole excess is refunded or retained as advance. Pending digital claims survive cancellation for separate verification.
- Typed staff requests whose approval performs cancellation, return or delivery correction in the same transaction. Distinct active-user conflicts have an owner resolution inbox.
- Signed upload-only recovery for revoked devices and explicit owner acceptance/rejection. Supported bills/deliveries/staff requests and original-owner cash repayments/returns replay atomically, retaining the original actor and reviewer history. Unsupported retained nonfinancial originals have an explicit owner-only manual reconciliation closeout; this records review without executing or fabricating replay.
- Owner bill PDFs, adjustment-history PDFs, optional payment/prior-debt presentation, quotation PDFs and quotation-to-draft copy with current-price warnings. Copying does not affect balances; one quotation cannot be confirmed twice.
- Owner reports with a consistent database snapshot, separate receipt reversals, cash repayments, refunds, returns/cancellations, pending claims, customer history, paginated fulfilment and device/quarantine visibility.
- Encrypted FCM tokens and durable owner approval jobs using Google's auth library and FCM HTTP v1; logged-out/revoked devices do not receive queued sends. Actual sending is disabled pending credentials and a phone test.
- Audit events include authenticated device/session context. Signed recovery uploads explicitly retain their source device.
- AES-256 encrypted PostgreSQL backup command, plus an automated restore test into a different database using the current schema.

## External activation requirements

- Owners enter actual supplier GSTIN/state/legal details, item HSN/rates and recipient details where required. Accountant approval/samples are not an activation prerequisite. Government e-invoicing is outside scope. Operational reversal records and reports are not separately issued legal credit notes or government filings.
- Firebase Admin service-account JSON for `billease-development`, followed by an owner-phone FCM test. The existing Android `google-services.json` is client configuration only.
- Separate Railway environments and Neon databases with protected credentials, verified TLS/storage encryption, actual starting invoice numbers and migrated opening balances.
- Scheduled off-host backup storage, retention and a production restore rehearsal. The local automated restore test does not prove the hosted backup plan.
- Production deployment checks, including actual proxy hop configuration and a security review of the running service. The current dependency audit is clean; continue checking updates before deployment.

Email recovery is intentionally inactive; recovery codes are the agreed V1 method. Late offline work across a financial-year boundary is held for review until its accounting treatment is confirmed. Historical quarantine rows without a captured role and unsupported legacy payload shapes need manual reconciliation.

## Frontend work

The Android Flutter development client now implements encrypted Drift storage, actual catalogue/unit row updates, secure tokens/device keys, a durable outbox, staff PIN/owner device unlock, offline leases, delivery permissions and owner notification registration. See [Frontend implementation status](../Frontend/IMPLEMENTATION_STATUS.md) for tested flows and remaining physical-device acceptance.

This is a tested development implementation of the supported domestic GST workflows. Intraterritory UTGST, cess, export-specific and registered mixed taxable/exempt cases are rejected. Hosted production configuration, backup/signing setup and physical-device acceptance remain outstanding.
