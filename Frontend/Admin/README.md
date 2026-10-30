# BillEase Admin

A separate browser frontend for business setup and access management. Serve this directory at `/admin/` on the same origin as `/admin/api/`. No build step, framework, external scripts or runtime dependencies are required. The server must serve `.mjs` as JavaScript and allow the bundled font and stylesheet under a `self` CSP. `index.html` uses no inline script or styles.

Authentication uses server-maintained HttpOnly cookies. The client sends `credentials: same-origin`, `X-Requested-With: BillEaseAdmin`, and the returned CSRF token on mutations. Session and CSRF information live only in memory. Financial APIs and operational records are absent from this frontend.

The default Access view answers who can work in each business. Businesses, Accounts, Devices and Activity each have their own searchable view. Security reads MFA status and rotates recovery codes after password and fresh MFA/recovery verification. Codes are removed from the DOM when their dialog closes. Creating an account does not grant business access or admin status.

New businesses require a business name and either Composition GST or Regular GST classification. The admin sets this classification; the owner supplies GSTIN, address, state and signatory details in the mobile app. There is no new non-GST business option.

A creation is identified by one generated UUID and a frozen original body. If its response is lost, the client checks `/directory` for that ID before replaying the same request. A definitive rejected request must also be checked before details can be corrected. Pending request bodies remain only in memory; closing or reloading the page clears them. The backend must treat repeated creation IDs safely, including transparent browser retries after a broken connection.

## Verification

```sh
node --check Frontend/Admin/app.js
node --test Frontend/Admin/model.test.mjs
node Frontend/Admin/tests/browser-smoke.mjs
```

The browser smoke test requires Node 22+, installed Chrome, and the taste skill's zero-dependency CDP module. Set `TASTE_SKILL_ROOT` if installed outside the default workspace path. It starts an isolated loopback mock API with explicit test-only identities, verifies real browser interactions, and writes screenshots to `tests/artifacts/`. The production client does not import the fixture or offer a preview mode. `--serve` starts only the isolated test fixture for manual inspection. Real-backend integration is a separate required check.

The smoke test covers cookie API request headers, login, all views, role assignment, uncertain creation, untrusted field rendering, named revocation, one-time recovery-code visibility, no browser credential storage, and 1440/768/390 layouts. Pure tests cover search, global role constraints, missing-date presentation and required GST classification. The mock browser creation test submits the classification and preserves it when reconciling a lost response.

## Design

Achromatic ledger, seed `1537707336`, no redraws. The existing BillEase Inter font, ink `#1b252d` and ground `#f1f3f5` are retained. The receipt mark and account-to-business access ledger give the screen its product identity. Each view's question is the relationship or record named by its title; there are no invented KPIs or charts. UUID sublines are shortened visually with the full ID available as their title. The design lint's em-dash warning refers to missing-value markers, which remain intentional. Font license: `assets/OFL.txt`.

The browser inspector reported zero failures at all three widths. Two warnings are retained deliberately: the lower canvas remains empty when the real fixture has one membership, and the short table is not stretched to match the unboxed access-rules rail. Adding filler rows or stretching the data frame would misrepresent the directory. The desktop, tablet and phone screenshots were visually reviewed.

Real-backend browser acceptance was completed against the disposable backend fixture on 2026-10-29. Verified actual recovery-code sign-in, HttpOnly SameSite=Strict session cookie, setup and access assignment/removal/reactivation/reassignment, business/account creation, real device enrolment and revocation with rejection of its old token, fresh-TOTP recovery rotation, old-code rejection and new-code sign-in, one-time code removal, financial-route isolation, static test-path exclusion, MFA audit rows, desktop/phone layout, and no JavaScript or CSP errors. Scripts are `tests/real-backend.mjs` and the resumable security finish in `tests/real-security-finish.mjs`; screenshots are in `tests/real-artifacts/`. The acceptance ran in stages after test locator and retained-route expectations were corrected. Admin directory activity includes administrative MFA events while excluding non-admin MFA events.

The 2026-10-29 real-backend acceptance above predates the GST setup changes. GST classification and metadata integration have local unit/widget coverage; hosted-production and physical-device acceptance remain separate.
