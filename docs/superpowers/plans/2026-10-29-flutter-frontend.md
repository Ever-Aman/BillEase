# Flutter frontend implementation plan

> Implement inline using the planning, test-driven development and verification skills. The user already delegated routine choices and authorised frontend development.

**Goal:** An Android phone/tablet app using the existing backend, encrypted local records, durable offline billing/delivery and owner workflows.

**Architecture:** Small Dart model, storage, API, sync and security services. A ChangeNotifier controller coordinates them; screens contain presentation and form validation. Drift uses SQLite3MultipleCiphers through native build hooks; keys and refresh/device secrets live in Android secure storage. Business caches are partitioned by server, user, business and role. Production and development have distinct application IDs and endpoints.

**Design:** Achromatic ledger (seed 457840717), bundled Inter, blue-grey ground, white working surfaces, ink actions, tabular rupee amounts. BillEase's signature is a billed / handed-over / remaining quantity strip, replacing the dealt stock sell-out signature because this app explicitly excludes inventory. Phones use bottom navigation; tablet screens expand their content rather than stretching controls. Preview data is isolated from real credentials and production builds.

**First-screen question:** What needs to be billed, handed over or reviewed today? New bill is immediately accessible. Totals derive from actual locally stored rows, and pending phone work stays distinct from synced figures.

- [x] Create Flutter Android/web-preview project and development/production flavors, preserving Firebase Android config.
- [x] Prove encrypted SQLite setup: cipher available, ciphertext on disk, correct-key reopen, wrong-key refusal.
- [x] Implement exact money/quantity models, scoped local cache, atomic price row replacement and immutable outbox/dependency handling; test them.
- [x] Implement password/MFA login, serialized refresh, device Ed25519 identity, secure local PIN/biometric unlock, inactivity lock, lease/clock-rollback checks and revoked-work preservation.
- [x] Implement cursor sync, independent operation retry/conflict handling and owner-only FCM registration; test failed upload persistence and role separation.
- [x] Build working bill/cart, customers, catalogue, bill/delivery detail, approvals, finance, quotations/PDF sharing, reports and security/settings screens.
- [x] Add the separate browser admin setup website and document its backend integration contract.
- [x] Run analyzer, tests, Android ARM64 development build, web preview build and real HTTP integration; record external phone acceptance and activation needs.

No live business, Firebase sending credential or release signing key has been provided. Those are configuration/test inputs, not a reason to fabricate a successful connection. Browser preview is for UI inspection; real encrypted operational storage targets Android.

Core owner/staff screens, guided recovery, CSV reporting/import and selected-line cancellation are implemented as described in `Frontend/IMPLEMENTATION_STATUS.md`. Native phone acceptance and production activation remain external follow-up requirements.
