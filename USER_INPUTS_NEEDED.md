# BillEase: information to provide later

This file tracks decisions and business information that only Aman, each business owner, or their accountant can confirm. Do not paste passwords, API keys, recovery codes, or private documents containing customer data here; store secrets in Railway or another protected secret store.

## GST business setup

- [x] Admin chooses **Composition GST** or **Regular GST** when creating a business and sets its display name. New non-GST onboarding is excluded; historical non-GST records are preserved.
- [x] Owners alone maintain supplier legal name, address, contact phone, GSTIN, state and signatory. Owners maintain item HSN and regular-GST rates/categories. These values are entered in the app rather than sent to the developer.
- [x] Prices are GST-inclusive. Regular invoices show separate CGST/SGST rates and amounts or IGST; composition Bills of Supply show HSN without tax columns.
- [x] Selected PDF: the supplied reference image, with two party panels, dark item header, payment details beside totals and separate component rates. See `output/pdf/billease-reference-template.pdf`.
- [x] Accountant-provided samples/approval are not an activation prerequisite. Required supplier/item/transaction details still apply.
- [x] Government e-invoicing is explicitly outside the requested product scope: no IRP submission, IRN or government QR integration.
- [x] Returns/cancellations use original bill tax snapshots and cumulative allocations. Remaining value after debt reduction is all refund or all advance. Adjustment histories and GST reports are operational records, not government filings or separately issued GST credit notes.
- [ ] Each owner enters and verifies actual business GSTIN/state/legal details and item HSNs/rates before billing.
- [ ] Confirm the financial-year boundary handling policy for late offline sales; current boundary cases require owner review.

## Existing invoice series and opening balances

- [x] Aman confirmed invoice numbering starts at **1** for the first bill. Owners initialize a new financial-year series with `lastNumber: 0`; the backend increments it on issuance. Do not reset an already-used series.
- [x] Existing customer debts are confirmed. Enter the amount still owed as an opening debt, rather than recreating historical sales.
- [ ] Each owner enters/verifies the existing customers and their opening debt amounts before new billing; enter any existing customer advance separately if applicable. Include the balance cutover date in the note and verify totals against the existing ledger. Do not enter both the old bills and their opening debt.

## Return settlement

- [x] After debt reduction, all remaining return value is either refunded or kept as customer advance. Split settlement is excluded.

## Email recovery

- [x] Aman will use a personal email for the admin account; email communications are intended for recovery only. Password and authenticator MFA remain the sign-in controls. The actual admin email has not yet been supplied/configured.
- [x] Email recovery stays inactive for now; one-time recovery codes are the temporary recovery method.
- [ ] Later, choose a transactional email provider and verify the sender address/domain.
- [ ] Test recovery and alert delivery in a development environment before enabling email recovery.

## Phone notifications

- [x] Decision: catalogue and price changes must update the phone's local database at the next sync, then show an in-app notice. The Flutter sync now updates the encrypted catalogue and unit rows transactionally; physical-device acceptance is still pending.
- [x] Staff requests and bills needing owner credit or digital-payment review should send push alerts to all active owners.
- [x] Development Firebase project: `billease-development`; Android application ID: `com.billease.mobile.dev`. Its Android configuration is in `Frontend/android/app/src/development/google-services.json`.
- [ ] Later use a separate Firebase project/application ID for production.
- [ ] Generate the development Firebase Admin service-account JSON and store it privately as `FIREBASE_SERVICE_ACCOUNT_JSON` in the development Railway environment. For local testing, the ignored `Backend/.secrets/development/firebase-service-account.json` path is supported. Do not paste the key into this file or chat.
- [ ] Test the built development Android app and FCM on an owner phone. The Android client configuration is wired through the Google Services plugin. Enable `PUSH_ENABLED=true` only after the credential and test device are ready.
- [x] Aman confirmed his own Android phone will be used for development testing. USB connection, device authorization, installation, and physical acceptance checks remain pending.

The step-by-step instructions are in [FIREBASE_SETUP.md](FIREBASE_SETUP.md).
- [x] Keep catalogue changes as in-app sync notices; no other V1 push category is required at present.

## Deployment and operations

- [x] Development Neon connection supplied in ignored `Backend/.env.development`; direct and pooled connections verified, migrations 001–030 applied, and pooled backend startup/health verified. Existing project: `Billease Development` (`little-snow-45880279`) in organization `Aman` (`org-withered-cake-84272061`). See [NEON_SETUP.md](NEON_SETUP.md).
- [ ] Create the development Railway environment/service and a separate production Railway environment and Neon project/database. The current Neon project's existing default branch is named `production`, but its application/database environment is development; do not use it for live production billing.
- [ ] Choose a backup retention plan and confirm that independent encrypted backups and a restore rehearsal are available before live use.
- [x] Development encrypted-backup command and isolated restore test are implemented. Hosted storage, scheduling and production recovery still need setup.
- [x] Business PDF layout selected; actual business logo, bank/payment details and custom terms remain optional configuration inputs.

Update this checklist as information becomes available. The backend status and unfinished engineering work are tracked separately in [Backend/IMPLEMENTATION_STATUS.md](Backend/IMPLEMENTATION_STATUS.md).

## Current release boundary

The development app and separate admin website are implemented. Completed engineering verification is recorded in `Frontend/IMPLEMENTATION_STATUS.md`; it does not establish hosted-production or physical-phone acceptance. Remaining external inputs are the Firebase Admin credential and owner/staff phone for push and native-device checks, separate hosted Railway/Neon environments, owner-entered GST business/item details, and private production Firebase/signing credentials. Complete the relevant configuration and acceptance checks before production billing or push.

## Mobile production release

- [ ] Provide a separate production Firebase Android client configuration for `com.billease.mobile`.
- [ ] Arrange the private Android production keystore and signing credentials; keep them outside source control.
- [ ] Provide a physical owner/staff Android device for notification, device-unlock, offline/reconnect and PDF-share acceptance.

## Render development hosting

Render is selected instead of Railway for current development hosting. Root `render.yaml` uses a free Singapore Docker service with manual deploys; see [RENDER_SETUP.md](RENDER_SETUP.md). Private GitHub repository `Ever-Aman/BillEase` is approved. Hosted setup and acceptance remain pending; free service sleep can delay background push delivery. Production remains separate.
