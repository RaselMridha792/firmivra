# R55: Bookkeeping Terms

Contract: `packages/types/src/bookkeeping/terms.ts`, `terms-client.ts` (`api.bookkeepingTerms`). API: extends `apps/api/src/bookkeeping`. Design: `docs/mockups/firm-workspace/bookkeeping/source/bookkeeping-close-reconciliation-and-report-review.jpg` (the Terms page, despite the file name) and sections 10 to 13 of `firmvra-bookkeeping-developer-instructions-fresh.docx`. Tables: `bookkeeping_terms`, `bookkeeping_terms_events` (R0 stage C1, `docs/work/R0-stage-c1-bookkeeping.md`).

## Steps

- [x] 1. Contract: the page (version in force, open draft, versions), New Terms, edit, send, back to draft, activate, terminate, notices, agreement links, history, payment schedule.
- [ ] 2. API, with unit, e2e and isolation cases.

## Progress

- 2026-10-19: step 1 (contract PR, `rasel/R55-bookkeeping-terms-contract`).

## Notes

1. Routes follow the bookkeeping contract: `clients/{id}/terms...` with the bookkeeping client's id (the profile id the module already uses), `terms/{termsId}/...` for one version.
2. Everyone who reaches the client reads; Owner and Admin change (Terms/Pricing is a manager's permission in the developer instructions). Internal notes are shown to Owner and Admin only.
3. One version in force and one open draft (DRAFT or SENT) per client. The database numbers the versions, keeps them from being overwritten, and supersedes the old one when a new one activates. The API adds the one-open-draft rule (409 TERMS_DRAFT_EXISTS).
4. New Terms copies the version in force (a change is a new version of it); with none, it starts from the client's package and the defaults.
5. Activate wants a signed copy or an e-signature by default (409 AGREEMENT_NOT_SIGNED); `requireSigned: false` lets an Owner or Admin bring unsigned terms into force.
6. The Payment Schedule reads the engagement's invoices from Invoices & Payments (never drafts); nothing is copied.
7. Agreement files are Documents' (uploaded with the client's `engagementId`) and the e-signature is Firm Sign's; this module only links them.

## Gaps against the design (not in this contract)

- **Send Payment Reminders** (Billing Terms): `bookkeeping_terms` has no column for it. Reminders are Invoices & Payments' setting today.
- **Generate Agreement / Download PDF**: making the agreement PDF from an approved template needs a PDF renderer for Templates' HTML. Until then the agreement is uploaded (Documents) and linked; the Agreement Preview card renders from the terms on the screen.
- **View Client Portal Version**: the client portal has no Terms page.
- **Refund / Credit Memo, Settlement Reference** (Billing & Payments): Invoices & Payments' and the bookkeeping ledger's routes, linked from the screen.

## Needs from others

- **R0 (if Rasel wants the toggle stored):** `bookkeeping_terms.send_payment_reminders boolean NOT NULL DEFAULT true`.
