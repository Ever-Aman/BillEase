# Remaining frontend and separate admin website

**Goal:** Finish the listed owner/staff mobile features and provide a separate browser admin website, without giving the admin role access to financial operations.

**Architecture:** Keep Flutter in Frontend/lib. Put the small framework-free admin website in Frontend/Admin, served at /admin by the existing Railway backend. Browser authentication uses an opaque HttpOnly SameSite cookie, server-side encrypted access/refresh state, exact-origin and CSRF checks; bearer tokens never enter browser storage. This same-origin deployment avoids extra hosting/runtime dependencies. Existing separate development/production backend configuration applies.

**Constraints:** No admin UI inside Flutter. No inventory/purchases, no split refund/advance. Known revocation fails closed. Preserve immutable outbox operations and never replay an uncertain financial action with a new ID. Accountant/provider/signing/device inputs remain explicit external requirements rather than fabricated success.

**Admin client contract:** /admin/api/session GET and /login POST return {user:{id,email,isAdmin},csrfToken,environment}. Mutations send X-CSRF-Token; login additionally sends X-Requested-With: BillEaseAdmin. /directory returns {businesses,users,memberships,devices,auditEvents}. POST /businesses {id,name}; POST /users {id,email,password}; POST /memberships {userId,businessId,role}; DELETE /businesses/:id/memberships/:userId and /devices/:id. GET /mfa; POST /mfa/recovery-codes with password plus mfaCode or recoveryCode. No operational data in directory or website. Normal errors are {error}.

- [x] Add tested cookie sessions, origin/CSRF enforcement, refresh serialization, idle/absolute expiry and admin-only directory/setup API. Audit all setup changes; retain last-owner protection and role constraints.
- [x] Build website login, searchable businesses/accounts/access/device views, recovery-code rotation and useful empty/error/retry states. Test against real disposable API and inspect desktop/mobile browser widths.
- [x] Finish mobile CSV template/preview/validation/import; custom date and fulfilment reports; selected-line cancellation; friendly correction controls. Test permission and financial bounds.
- [x] Complete signed recovery of offline customers and uncertain owner operations using typed allowlists and original idempotency, with owner reconciliation; preserve originals and dependencies. Test revoked upload/read isolation and already-applied cases.
- [x] Broaden Flutter/backend integration tests for these flows, quotation copying and device/MFA behavior. Build final Android artifact and verify production-signing guard.
- [x] Update readiness and user-input tracking with exact checks and remaining physical/infrastructure acceptance. Physical-phone notifications/credentials and production keys cannot be simulated as verified.

## Execution record

- Added typed, signed recovery for supported offline customer and uncertain owner operations; preserved original IDs, dependencies and owner reconciliation.
- Added mobile CSV import/status, custom IST reporting, fulfilment projections, selected-line cancellation, quotation copy warnings and safer correction controls.
- Added regression coverage for CSV reconciliation/atomic import, recovery boundaries, and owner/staff visibility. Full Flutter and release verification is recorded in `Frontend/IMPLEMENTATION_STATUS.md` after the final source-stable run.
- Real-backend admin browser acceptance verified setup, access lifecycle, device revocation, recovery-code rotation, audit visibility and phone layout; three mock-model unit tests pass.
- Remaining acceptance is external: Firebase Admin credentials and physical owner/staff phone, separate hosted Railway/Neon environments, accountant-approved GST samples, and production Firebase/keystore.

Parallel work is limited to disjoint mobile UI, recovery, admin frontend and admin backend files. Review changes before integrating; use isolated test databases and keep generated secrets out of logs.
