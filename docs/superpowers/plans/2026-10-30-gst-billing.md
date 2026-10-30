# GST Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement the approved composition/regular GST business setup, inclusive tax snapshots, quotations, return reversals and reference PDF layout.

**Architecture:** Retain Express routes, focused services and pg transactions. Catalogue tax metadata travels in the existing revision/sync payloads; financial tax data is frozen into document snapshots. Separate workers own the backend core, frontend setup and adjustment allocations; the main agent owns PDF integration, review and acceptance.

**Tech Stack:** Node.js 24, Express, PostgreSQL, PDFKit, Flutter, existing plain JavaScript admin website.

**Spec:** BillEase-V1-Specification.md financial/security requirements, supplemented by Aman's 30 October decisions and docs/research/gst-document-options.md.

## Global Constraints

- Integer minor-unit money and basis-point rates; use BigInt for financial arithmetic.
- Preserve operation IDs, audit records, role isolation and immutable historical snapshots/layout revisions.
- Admin chooses composition or regular GST at business creation; owner sets supplier details/GSTIN and item tax metadata.
- No accountant-provided sample prerequisite; use the selected reference layout and required applicable document particulars.
- No split return settlement: reduce debt, then all refund or all advance.
- Keep existing non-GST records readable; do not offer new non-GST businesses in the admin UI.
- Do not infer tax applicability, fabricate QR codes or enable government e-invoicing without a separate integration.
- Tests use disposable local databases; no secrets, live Neon data or production environment changes.

## Review Focus

- Partial returns/cancellations interleaved across an odd-paisa line must not reverse more tax or gross value than originally issued.
- Catalogue changes must not erase omitted tax fields or rewrite stored financial tax snapshots.
- Missing place of supply, supplier/recipient identity mismatches and unsupported supply types must fail clearly before invoice numbering or ledger writes.
- Old offline clients must not silently strip tax metadata or submit a GST bill without required transaction fields.
- Old and unknown document layout revisions must preserve the original known layout or refuse rendering, never guess.

## Task 1: Shared PDF layout and historical reproduction — main/PDF workers

- [x] Add a reusable reference renderer, separate CGST/SGST rate columns, IGST variant and untaxed Bill of Supply.
- [x] Test exact money, date formatting, long-description pagination and composition declaration placement.
- [x] Integrate bills, quotations and composition draft; preserve known legacy revisions and reject unknown revisions before response headers.
- [x] Adapt new GST tax snapshots to item columns, correct document title and totals.
- [x] Inspect real-renderer samples and run isolated integration regressions.

## Task 2: GST backend — gst_billing_backend

- [x] Add migration 029, explicit creation mode, owner supplier/item metadata and customer identity fields.
- [x] Implement inclusive extraction and immutable bill/quotation tax snapshots, with explicit place of supply and supported-case validation.
- [x] Preserve gross ledger, existing payment reviews, numbering and idempotency; test tax arithmetic and historical snapshots.
- [x] Update API descriptions and communicate the final contract to the frontend and PDF owners.

## Task 3: GST frontend — gst_setup_frontend

- [x] Add required admin mode selection and owner profile/catalogue/customer tax fields.
- [x] Collect place of supply for bills/quotations; preserve metadata in local sync, scope guards and existing immutable outbox payloads.
- [x] Remove stale accountant-approval/non-GST-onboarding copy from current GST flows.
- [x] Run focused regression widgets, full analyze and relevant admin tests.

## Task 4: GST returns/cancellations — gst_return_tax

- [x] Add migration 030 with immutable operational tax-reversal snapshots.
- [x] Allocate cumulative original tax across interleaved partial returns/cancellations without over-reversal; retain original bill and line references.
- [x] Keep debt-first all-refund/all-advance settlement and existing idempotent review behavior.
- [x] Test odd-paisa and full-reversal cases; distinguish operational adjustments from issued legal credit notes.

## Task 5: Main integration and acceptance

- [x] Review all workers' code and API/storage boundaries; add migration 030 to the ordered migration runner after 029.
- [x] Run the complete isolated backend suite and Flutter/admin checks; run real Dart-to-Node integration where affected.
- [x] Render/inspect the final PDF examples and actual API-derived GST documents.
- [x] Refresh the code graph, external-input checklist and implementation status; report remaining unsupported integrations accurately.

## Final handover

Implementation and local integration verification are complete. Hosted Railway/container acceptance, physical Android testing and owner-supplied business data remain external acceptance steps; see `USER_INPUTS_NEEDED.md`. Government e-invoicing remains outside scope.
