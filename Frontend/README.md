# BillEase Flutter app

Android development app, with a browser-only sample workspace for visual review. The native app uses the existing Node backend; it never switches to sample data when login, storage or networking fails.

## Run

Flutter 3.47.7 / Dart 3.13.5 and the Android SDK are installed on this workstation. The Flutter binary is `/media/neveraman/New/development/flutter/bin/flutter`.

```bash
cd Frontend
flutter pub get
flutter run --flavor development --dart-define=APP_ENV=development --dart-define=API_BASE_URL=http://10.0.2.2:3000
```

`10.0.2.2` reaches the host backend from an Android emulator. For a USB-connected phone, use `adb reverse tcp:3000 tcp:3000` and set `API_BASE_URL=http://127.0.0.1:3000`. A hosted development backend can use its Railway HTTPS address. Start/configure the backend separately as described in `../Backend/README.md`.

Browser preview, with clearly labelled in-memory sample data:

```bash
flutter run -d chrome --dart-define=UI_PREVIEW=true
```

Operational browser storage is disabled. `UI_PREVIEW=true` is forbidden with `APP_ENV=production`.

## Implemented flows

- Email/password login with authenticator or one-time recovery code; device-bound Ed25519 identity; secure token/key storage and refresh rotation.
- Owner phone-security unlock; staff six-digit PIN and attempt limits; background/inactivity lock; offline-lease and clock-rollback checks.
- Business switching, role-scoped local records, transactional catalogue/unit price updates and historical bill snapshots.
- Customer creation; resumable item/unit/quantity cart; owner price overrides; cash/UPI/bank entries and saved-customer credit. Submission persists an immutable operation before networking. Final numbers come from the server.
- Mixed-unit handovers, saved quantity permissions, original conversions, dependent offline delivery uploads, billed/handed-over/remaining quantities and delivery review/correction requests.
- Returns and undelivered cancellation, with whole remainder as advance or whole remainder refunded after debt reduction. Approval applies the action immediately.
- Owner cash repayments, opening balances, advance application, ledger and payment corrections; staff request status; owner credit/payment/request review and recovered-work review.
- Owner catalogue editing; report cache with server timestamp and stale marker; quotation creation/PDF/copy to bill draft; bill PDF sharing and adjustment history.
- CSV template download, validation, preview, read-only status reconciliation and atomic import; custom IST report ranges and fulfilment views; selected-line cancellation; quotation copy warns when saved prices differ from the current catalogue.
- Device revocation, MFA setup and recovery-code replacement; admin-selected GST classification, owner document profile and financial-year numbering.
- Durable retry and signed recovery for uncertain owner actions and supported offline customer work: originals, IDs and dependencies are retained for owner review. Entering a second action at an uncertain endpoint is blocked until the first outcome is reconciled.

## Storage and sync

Native Drift uses SQLite3MultipleCiphers through the `sqlite3` build hook. Opening a plaintext SQLite library is refused. Each account has an encrypted database and an Android secure-storage key; endpoint/environment namespaces separate development and production. Files are excluded from Android backup. Release Android windows prevent screenshots.

Each pull page updates item and unit rows, historical revisions and the cursor atomically. Existing drafts and bills retain saved prices. Owner financial bill projections are refused by staff cache validation. A known authentication/access denial cannot return a cached owner report as a fallback. Independent uploads continue after a version conflict; conflicting work is retained for owner review rather than silently merged.

Customer creation and dependent bills/handovers share stable UUIDs. Signing out retains unsent work and queues an interrupted server logout for retry. After revocation, the sign-in/unlock screen offers signed upload of supported saved work for owner review; see `IMPLEMENTATION_STATUS.md` for limits and acceptance status.

Shared PDF exports are temporary and excluded from backup. Previous exports older than 24 hours are removed on the next share, rather than deleting a file before the receiving Android app reads it.

## Firebase and environments

The supplied client configuration is `android/app/src/development/google-services.json`, for `billease-development` / `com.billease.mobile.dev`. Owners alone request notification permission and register for approval messages. Catalogue changes use row updates plus in-app notices. Background notifications on a physical phone still need verification and the backend Admin credential.

Production uses `com.billease.mobile`, HTTPS, its own Firebase configuration and a private release keystore. Production release tasks fail without `android/key.properties`. Never put a Firebase Admin private key in Flutter assets. See `../USER_INPUTS_NEEDED.md` and `../FIREBASE_SETUP.md`.

```bash
flutter build apk --release --flavor development --target-platform android-arm64 --split-per-abi --dart-define=APP_ENV=development --dart-define=API_BASE_URL=http://127.0.0.1:3000
```

For this USB development APK, run `adb reverse tcp:3000 tcp:3000` with the local backend running. This creates an optimized **development** app using the development signing key. It is not a production publication artifact.

## Verification

```bash
flutter analyze
flutter test
```

A disposable integration runner creates an isolated PostgreSQL database, runs migrations, starts the real Node API, runs the Dart HTTP test and drops the database afterwards:

```bash
cd ../Backend
TEST_DATABASE_URL='postgresql://neveraman@localhost/postgres?host=%2Fvar%2Frun%2Fpostgresql' FLUTTER_BIN=/media/neveraman/New/development/flutter/bin/flutter npx --yes --package=node@24 node scripts/flutter-smoke.mjs
```

The HTTP test is deliberately skipped during ordinary `flutter test`; run the integration runner to execute it. Do not point test maintenance URLs at a production server.

See `IMPLEMENTATION_STATUS.md` for verification evidence and unfinished work.
