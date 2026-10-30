# BillEase backend

Node.js 24 LTS, Express, PostgreSQL. `app.js` wires routes; `server.js` starts the server and workers. Code is split into `routes/`, `services/`, and `utils/`. This is a development backend for the [project specification](../BillEase-V1-Specification.md). See [API.md](API.md) for the Flutter contract and [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for activation requirements.

## Environments

Use different Neon databases, Railway environments, JWT secrets, and MFA encryption keys for development and production. Set `APP_ENV`, `DATABASE_ENV`, `DATABASE_URL`, `JWT_SECRET`, and `MFA_ENCRYPTION_KEY`. `DATABASE_URL` must be the direct PostgreSQL URL and is used for migrations. Optionally set `DATABASE_URL_POOLED` to a Neon pooled URL for application runtime connections; when omitted, runtime uses `DATABASE_URL`. The database stores an environment marker and startup refuses a mismatch. Production requires TLS in each configured database URL.

The separate administrator website is served at `/admin/` by this backend. Set `ADMIN_WEB_ORIGIN` to its exact public origin in production. Its opaque, HttpOnly, SameSite Strict session cookie and CSRF/origin protections are separate from Flutter bearer-token authentication. Admin status grants nonfinancial setup access only; it does not grant business or financial access. See [Frontend/Admin/README.md](../Frontend/Admin/README.md).

For local development, copy `.env.development.example` to `.env.development`, fill it in, and run:

```sh
npm ci
node --env-file=.env.development src/migrate.js
BOOTSTRAP_ADMIN_EMAIL=admin@example.com BOOTSTRAP_ADMIN_PASSWORD='a-long-unique-password' node --env-file=.env.development src/bootstrap.js
MFA_USER_EMAIL=admin@example.com node --env-file=.env.development src/mfa-setup.js
RECOVERY_USER_EMAIL=admin@example.com node --env-file=.env.development src/recovery-codes.js
npm run dev
```

Activate Node 24 using your version manager and `.node-version`. If the system still uses an older Node, the cached temporary runtime can run the development command with `npx --yes --package=node@24 -c 'npm run dev'`.

Store the one-time MFA secret and recovery codes securely. In Railway, use the repository root with the root `Dockerfile` and `/railway.json`; the image runs from `/app/Backend`, starts with `npm start`, and migrates with `npm run db:migrate`.

## API and cache

`POST /v1/auth/login` accepts email, password, a stable client-generated device UUID, device name, an Ed25519 public key encoded as base64 SPKI DER, and an MFA code or recovery code when required. It returns a 15-minute access token, rotating refresh token, active memberships, and the server's seven-day offline authorization expiry. Use `POST /v1/auth/refresh` and `POST /v1/auth/logout`. Other routes require `Authorization: Bearer <accessToken>` and active membership. Admin status alone gives no operational business access.

Routes under `/v1/businesses/:businessId` cover catalogue and CSV import/preview, customers, bills and partial/full undelivered cancellation, payment and credit decisions, dated opening balances and repayments, advance applications, delivery events and review, mixed-unit returns, ledger/payment/delivery corrections, staff requests, quotations, owner PDFs and reports. A correction can atomically reverse the original ledger effect and create an optional replacement. Approving a staff cancellation, return, or delivery correction applies that action in the same transaction. `GET /sync?cursor=0` returns ordered catalogue, customer, bill and owner quotation changes. Owner bill projections include financial data; staff bill sync includes delivery details without prices or balances.

Owners can download a preserved original bill PDF and `GET /bills/:billId/adjustments/pdf` for its return, refund, payment correction, and cancellation history. This history is a non-GST operational statement, not a GST credit note.

Owners must explicitly initialize `/settings/document-series` with the last number used in that financial year before billing. Use zero only after confirming that the business is starting at number 1. Optional bill PDF query parameters are `showPayments=true` and `showPriorDebt=true`. Quotations have their own `/quotations/:id/pdf` endpoint and do not consume invoice numbers or change balances.

Flutter should store the pull cursor, role-appropriate records, and an outbox in encrypted local SQLite. Save an offline event and its outbox operation together; apply each pull page and cursor together. For a catalogue change, replace the item's local row and unit rows, including `priceMinor` and conversion `factor`, before committing the cursor; then show an in-app notice. Pull on open, resume, reconnect, and explicit retry. `active: false` catalogue/customer revisions are tombstones. A saved `operationId` represents one intended edit and must be reused unchanged on retry.

Offline conflicts return `outcome: "review_required"` and a `conflictId`. Each distinct failed operation is retained in the owner-only `GET /conflicts` inbox. An owner resolves it through `POST /conflicts/:id/resolve` with `resolution` (`discarded`, `retry_after_sync`, or `superseded`), a reason in `note`, and a new decision `operationId`. `superseded` also needs an existing `replacementOperationId`. Financial actions are never merged by device time. Catalogue/customer edits need the current version and a new operation after review. Old catalogue prices on bills remain valid when their historical revision is valid. Delivery events remain separate and report excess handed-over quantity for owner review.

Owner push jobs are queued with staff correction/cancellation/return requests and staff bills needing credit or digital-payment review. The owner app registers its FCM token through `PUT /v1/devices/:deviceId/push-token` using the access token for that same device, and removes it with `DELETE`. Set `PUSH_ENABLED=true` and `FIREBASE_SERVICE_ACCOUNT_JSON` in the Railway environment to deliver queued notifications. Keep the JSON credential out of source control. The notification has a generic message; the owner app opens the referenced request or bill after authenticating. Catalogue changes only use the sync notice.

For local development, `FIREBASE_SERVICE_ACCOUNT_PATH` may point to the ignored `.secrets/development/firebase-service-account.json`. Set `FIREBASE_PROJECT_ID=billease-development` to reject a credential from another project. Keep `PUSH_ENABLED=false` until an owner phone is registered.

Amounts are integer paise. Bill and delivery `quantityMilli` values are quantities times 1,000. Unit conversion factors are exact decimal strings. Admin chooses `composition` or `regular_gst` at creation. Owners complete legal details, initialize the first series with last number 0, and configure HSN plus applicable regular-GST rates/categories. Inclusive tax calculations and document type are saved in issuance snapshots. `POST /composition/preview` is a draft preview without an accountant-approval prerequisite. Government e-invoicing is outside scope.

## Remaining work before live use

Email MFA recovery is intentionally inactive until a provider and verified sender are configured; one-time recovery codes work meanwhile. Owners can enable MFA and replace recovery codes through `/v1/me/mfa` routes. All users can view/revoke their own devices. A revoked device can send signed old work to `/v1/recovery/upload`; owners accept or reject it with `/quarantine/:deviceId/:operationId/decision`. Valid supported work replays atomically with its original actor. An accepted staff request still needs its normal owner decision. See API.md for the exact original-owner repayment and return recovery payloads.

Before live use, complete the external activation requirements in IMPLEMENTATION_STATUS.md. Actual supplier/item/customer details and supported place-of-supply data are required before billing; Firebase sends need an Admin credential plus a phone test.

## Tests

Use Node 24 and a disposable development PostgreSQL server. The test role needs `CREATEDB`; the application's deployed role should not. Install PostgreSQL client tools (`psql`, `pg_dump`, `pg_restore`), GnuPG and Poppler's `pdftotext` for backup/PDF tests.

```sh
TEST_DATABASE_URL='postgresql://test-user:password@localhost/postgres' npm test
```

The runner creates a separate random `_tdd_` database for each test file, runs all migrations, and drops that database afterwards. It never migrates the maintenance database in `TEST_DATABASE_URL`. Individual files can be selected with `npm test -- test/adjustments.test.js`. Tests cover financial limits, original-value unit conversions, concurrent returns, cached delivery coverage, HTTP permissions, session rotation, MFA/recovery, the MFA/sign-in race, quotation/PDF output, sync and an encrypted backup restore.
