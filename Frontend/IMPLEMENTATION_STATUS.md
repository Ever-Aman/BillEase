# BillEase frontend implementation status

The Android owner/staff app and separate browser admin website are implemented for development use. This status records engineering checks; it does not claim hosted production or physical-phone acceptance.

## Verified in this completion run

- Flutter analyze: no issues.
- Flutter unit/widget suite: 63 passed after the 30 October GST integration; the real HTTP test is skipped during ordinary `flutter test` by design.
- Disposable real Dart client → Node API → isolated PostgreSQL integration: passed. It exercises signed device login, business/catalogue/customer sync, bill upload, delivery definitions, PDF download, logout and staff-safe synchronization.
- Full backend suite on Node 24: 33 isolated test files (51 cases) passed; the additional deployment-packaging file passed 2 tests, including pooled/direct connection isolation, CSV status/atomic import, signed recovery, explicit close, authorization boundaries, admin sessions/MFA and refresh/revocation behavior.
- Admin pure model tests: 3 passed. Real-backend browser acceptance verified setup/access lifecycle, device revocation, recovery-code rotation, financial-route isolation and desktop/phone layouts. Admin MFA audit visibility and owner-event exclusion were verified separately by backend HTTP tests.
- Android ARM64 development release built with `API_BASE_URL=http://127.0.0.1:3000`: [app-arm64-v8a-development-release.apk](/media/neveraman/New/BillEase/Frontend/build/app/outputs/flutter-apk/app-arm64-v8a-development-release.apk), 23.3 MB (23,342,647 bytes). It uses the development signing key and USB `adb reverse tcp:3000 tcp:3000`; it is not a production publication artifact.
- Flutter web preview built successfully with `UI_PREVIEW=true` at `build/web`. Preview uses labelled in-memory sample data, not operational storage.
- Production Android release guard was previously checked and correctly refuses a production build without the private keystore.

## Earlier owner onboarding update — 30 October 2026

- The owner document profile now exposes optional GSTIN and authorised signatory fields, prefills saved values and preserves them on save. GSTIN is normalized to uppercase. Required supplier name/address/phone validation remains in place; blank optional fields do not block non-GST setup.
- Opening-balance corrections now include the original debt/advance kind; repayment corrections retain their amount-only replacement payload. Regression widget tests cover all three cases.
- Main-agent review and the full Flutter suite passed; Flutter analyze reports no issues. The isolated backend ledger-correction test also passed.
- Admin-only business creation/name and owner-only document profile/series permissions were checked. The latest GST update requires admin classification at creation. Numbering starts at 1 after the owner initializes the new series with last number 0.
- Decisions and sample requirements are recorded in `../OWNER_ONBOARDING.md` and `../USER_INPUTS_NEEDED.md`. The latest development APK has been rebuilt with GST integration. ADB currently reports no connected Android device; physical acceptance remains pending.

## GST integration - 30 October 2026

- Admin selects composition or regular GST at creation. Owner supplier details, catalogue HSN/rate/category, customer legal metadata/editing, explicit place of supply and inclusive pricing are wired to the backend.
- Saved document tax summaries and operational original/reversed/net GST reports are visible to owners; catalogue sync retains tax fields in the encrypted local store.
- Existing queued operations keep their identifiers/payloads; metadata edits append versioned jobs. Quotations retain their prices and warn on current catalogue changes.
- Government e-invoicing is excluded. Physical-phone behavior still requires acceptance on Aman's device.

## Implemented owner/staff flows

- Email/password and MFA/recovery-code sign-in, device identity and revocation, encrypted offline storage, scoped sync, immutable queued operations and owner-reviewed recovery.
- Billing, customer/catalogue management, mixed-unit fulfilment, delivery review, returns/cancellation, ledger corrections, quotations and PDF sharing.
- CSV templates, validation and preview, owner-only read-only status reconciliation, atomic import, custom IST reports, fulfilment views and selected-line cancellation.
- Quotation copy warns about catalogue price changes. Uncertain actions preserve original identifiers and require reconciliation before another action can proceed.
- CSV recovery remains device-local: once access is restored for the original owner, the exact retained CSV can be resumed for review. It is not uploaded as recovery data. Explicit manual closure of known nonfinancial retained work requires a note and preserves the original.

## External acceptance still required

- Owner/staff physical Android phone checks for device unlock/biometrics, push notification delivery and taps, PDF sharing, and long offline/reconnect sessions. Emulator validation did not replace a physical phone run.
- Firebase Admin service-account credential and development phone for push acceptance; separate production Firebase client configuration.
- Separate hosted development/production Railway environments and Neon databases, plus backup scheduling and off-host restore acceptance.
- Owner-entered actual GSTIN/state/legal details and HSN/rates; accountant-approved templates are no longer a project prerequisite.
- Private production Android keystore and signing credentials. Do not enable production billing or push until the applicable external inputs and acceptance checks are complete.

Email recovery remains intentionally inactive. See `../USER_INPUTS_NEEDED.md` for the external input checklist.
