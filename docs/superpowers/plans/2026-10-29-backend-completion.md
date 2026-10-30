# Backend completion implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task. The user authorised direct execution and independent routine decisions.

**Goal:** Close the non-GST financial and delivery gaps before deployment integration.

**Architecture:** Keep Express routes thin and transactions in services. Preserve original bills and append adjustment records. PostgreSQL numeric arithmetic handles saved conversions; integer paise handles money.

**Tech stack:** Node.js, Express, PostgreSQL, Zod, PDFKit.

**Spec:** `BillEase-V1-Specification.md`, with the user's later composition and no-split settlement decisions.

## Global constraints

- Separate `Backend` and `Frontend`; keep development and production separate.
- Owner-only balances, approvals, corrections, reports and PDFs.
- After debt reduction, remaining adjustment value is wholly refunded or wholly kept as advance.
- GST activation waits for approved accountant samples and business GST details.

## Review focus

- Mixed units and fractional original units must retain exact quantity limits.
- Concurrent return/cancellation attempts cannot exceed original quantity or value.
- Delivered and returned quantities cannot be cancelled or scheduled again.
- Pending digital claims cannot fund delivery; permitted quantities reveal no money to staff.
- Retried financial operations apply once and reject changed payloads.

### Task 1: Mixed-unit returns and partial cancellations

Files: `Backend/migrations/017_adjustment_quantities.sql`, `src/services/adjustments.js`, `src/services/returns.js`, `src/services/cancellation.js`, relevant routes, `test/adjustments.test.js`.

- [x] Add failing database tests: one box = 10 pieces; return 3 pieces from a box priced 1000 paise yields 300; cancellation cannot include delivered quantity; a repeated operation has no second ledger effect.
- [x] Add exact canonical quantity snapshots and append-only cancellation lines.
- [x] Implement common original-value calculation and debt/refund/advance settlement.
- [x] Expose optional saved unit on returns and partial cancellation lines.
- [x] Run isolated database tests.

### Task 2: Delivery authorization and fulfilment projection

Files: `src/services/delivery.js`, `src/services/catalogue.js`, `src/routes/delivery.js`, `test/delivery-coverage.test.js`.

- [x] Test partial confirmed coverage, mixed units, prior deliveries, owner credit approval, and staff projection without prices.
- [x] Publish safe canonical quantity permissions with a server revision; preserve distinct delivery events and report excess.
- [x] Derive billed/delivered/returned/cancelled/pending quantities without redelivery after returns.
- [x] Run isolated database tests.

### Task 3: Reports, document options and deployment readiness

Files: reports/document services and routes, environment examples and operations/status docs.

- [x] Include standalone repayments, pending claims, adjustments, review requests and quarantine counts in owner reports.
- [x] Support owner PDF presentation options with preserved original context.
- [x] Verify migrations, financial regression tests, source syntax and dependency audit.
- [x] Record external activation inputs and precise remaining limits.

No Git commit is possible until this workspace is initialised as a Git repository.

## Execution record

- Implemented all three tasks inline, with failing-then-passing database regressions for the financial and permission changes.
- Ruling: cancellation preserves pending digital claims for separate verification; cancellation is not proof that money was never received.
- Ruling: saved delivery permissions carry quantities only. Overlapping valid offline handovers are retained as disputes rather than silently discarded.
- Ruling: invoice series requires explicit owner initialization before issuance, because existing invoice numbers remain an external input.
- Added original-owner payment/return quarantine replay, dated opening/repayment corrections, app MFA/device management, quotation PDFs/current-price warnings, stale-price acceptance flags and authenticated audit device context found missing during the spec check.
- Fixed HTTP business parameter inheritance and route-wide owner middleware that blocked staff routes.
- Independent review identified a sign-in/MFA enrollment race. A permanent concurrency test reproduced the failure; user/device/session locking fixed it and the test passed.
- Replaced Firebase Admin's unused Firestore/Storage dependency tree with the official Google Auth library and FCM HTTP v1 adapter; 141 packages were removed and the dependency audit is clean.
- Final verification: 19/19 test files passed on Node 24.22.2; migrations 001–025, source syntax, formatting, PDF inspection, server startup/shutdown, encrypted backup restore and production dependency audit passed.
- External GST samples, Firebase Admin credential/phone test, hosted environments and off-host backup scheduling remain activation requirements in USER_INPUTS_NEEDED.md and Backend/IMPLEMENTATION_STATUS.md.
