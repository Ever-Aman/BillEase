# Owner bill upload fix — 1 November 2026

## Observed cause

The affected development business had a document profile but no current-financial-year document series. The server returned `Document series must be confirmed before billing` (HTTP 409). Flutter labeled every 409 `review_required`, then excluded that job from subsequent sync attempts. This was a blocked upload, not staff-credit approval.

The development business had zero issued bills. Its series was initialized through the existing settings service with last number 0, following the previously agreed first invoice number 1. No bills or receipt claims were fabricated or automatically replayed.

## Changes

- Distinguish explicit server financial-conflict outcomes from ordinary setup/validation failures.
- Display the saved server error and a fallback when older jobs have no detail.
- Owners can retry the stored original rejected/legacy-review bill, preserving its payload, operation ID and dependencies. Server validation/conflict rules still apply.
- New owner-entered cash/UPI/bank receipts are confirmed and allocated immediately. Staff digital receipts retain owner verification. Fully paid owner digital walk-in bills are accepted.
- Existing issued pending payment claims are not silently mass-confirmed.

## Applying and testing

Deploy the backend changes from Development manually in Render. Install the updated development APK over the existing app using the same signing key; do not uninstall or clear storage while work remains unsynced. Open Saved work & sync, select Retry original bill, and confirm issuance/sync. If another validation error appears, correct that setup and retry the same original. Actual financial conflicts remain subject to explicit owner resolution.

For new businesses, owner setup must include the legal/tax profile and financial-year series before issuance. Last number 0 is appropriate only for an unused series starting at 1. Never reset an existing series.

## Verification

62 backend tests across 35 files passed on isolated local databases. Thirteen focused Flutter tests passed, and targeted Dart analysis found no issues. Mobile update version: 1.0.1+2, development flavor, Render API. Hosted backend still requires manual deployment of the updated Development commit. Physical-phone installation/issuance acceptance remains to be checked.
