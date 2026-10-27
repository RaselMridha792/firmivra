# R56: Invoices & Payments (Octavia's Oct 27 review)

Rasel (Oct 28): R61 will not run; R56 takes the Invoices & Payments items of `docs/specs/review-2026-10-27/CHANGE-LIST.md`, section A (with `invoices-payments--developer-review.md`, findings IP-001 to IP-070). Order: first the diagnosis items that may be bugs in existing code (IP-F20 Payment Methods without data, IP-F22 the empty Financial Report, IP-F23 the report PDF, IP-F24 saved reports), then IP-F06 to F09 (due rules, the independent Sent state, eligible edits, row actions) and IP-F17 (routes). IP-F01 to F05, F12 and F13 (Create Invoice, the template library) are R60's. Up to three R56 PRs open at once, after the current queue; build locally while waiting. Reuse `OriginLink`, `ActionMenu` and `NewMessageDialog`. No schema change (needs go below). Nothing sends, charges or refunds for real.

## Owned paths

`apps/web/src/app/firm/(workspace)/invoices/**` except the Create Invoice files (`invoices/new/**`, `_components/invoice-editor.tsx`, `_components/invoice-form.tsx`: R60's), `apps/web/src/app/firm/(workspace)/reports/**` for IP-F20 to F26, `apps/web/src/mocks/invoices.ts` and `mocks/reports.ts` (the parts these items need), the matching API code in `apps/api/src/payments/invoices/**` and `apps/api/src/reports/**`, their contracts in `packages/types`, their tests, and `apps/web/e2e/mock/r56-invoices-*.spec.ts`.

## Steps

- [x] 1a. IP-F20 and IP-F22: money recorded by hand counts (diagnosed and fixed)
- [ ] 1b. IP-F23 (report PDF and Excel, the download) and IP-F24 (Saved Reports reachable)
- [ ] 2. IP-F06 due rules in the firm's timezone (Due Soon, Due Tomorrow, Due Today, Overdue), the Due Today card and tab
- [ ] 3. IP-F07 the independent Sent tag from the real send history
- [ ] 4. IP-F08 Edit/Correct for eligible unpaid invoices (reason and audit for a sent one), distinct Draft and Canceled badges
- [ ] 5. IP-F09 the row menu additions (Preview, Download PDF, Add Note, Log Activity, Create Task, Schedule Follow-Up, View Client Portal, Send Reminder first)
- [ ] 6. IP-F17 routes for Recurring Invoices, Client Statement, Payment Link Generator and View All Payments (check what exists first)

## Needs from others

- **R60 (Create Invoice):** Edit and Create share `invoice-editor.tsx`. IP-F08's correction reason for a sent unpaid invoice is asked in a dialog outside the editor; anything inside the editor (field limits per status) is R60's file.

## Progress log

- 2026-10-28: R file started; the four diagnosis items first.
- 2026-10-28: Diagnosis (code, not data): Record Payment writes `offline_payments`, which nothing in the overview or Reports read. IP-F20: the Payment Methods chart was a fixed empty ring (the invoice list has no method). IP-F22: the `payments_received` source read only Stripe's `payments`, so a firm whose test payments were recorded by hand saw an empty Financial Report; "By Group" broke down by status, always Succeeded. IP-F23: the API answers 400 VALIDATION_FAILED on `format` for PDF and XLSX (only CSV is built), which the screen showed as "Some details need fixing"; even CSV never downloads; the label says "Excel (XLSX)". IP-F24: saved reports are stored and listed at `/reports/library?tab=saved`, but nothing on `/reports` links there.
- 2026-10-28: IP-F22 and IP-F20 on `rasel/R56-ip-diagnosis`: `payments_received` loads recorded payments that are not voided (method in words, processor MANUAL, the day received) and gets a Service field (the invoice's catalog service, "Multiple services" or "Custom items"); its breakdown is by payment method. A run's `breakdownBy` (D2, "Group By") changes the breakdown only, checked like the sort (INVALID_DEFINITION for a field that is not groupable). `GET /business/invoices/payment-methods?from&to` (the firm's calendar, this year by default): money collected by method, Stripe's less confirmed refunds plus recorded ones not voided, Staff their clients only, audited; the overview's Payment Methods chart reads it, with D1's dropdown (All, Card, Cash, ACH, plus Check and Other once used). The mock's Revenue Summary now runs on a `payments_received` source as the API's. Tests: reports e2e 21 of 21 (one new: a recorded check counts by method, Group By by client and service, a voided one leaves), payment-methods e2e 3 (sums, refunds, voided, ranges, Staff, firm B, 400, audit), contract 3, mock `r56-reports` 7 of 7, `r56-invoices` one new.
- Found on the way (fix with IP-F06): Record Payment's date and the overview's "today" are the browser's date, not the firm's: a person east of the firm (Dhaka for a New York firm, before about 10 in the morning there) gets "Some details need fixing" for a payment dated today. `r56-invoices`' Record Payment test fails at those hours on main too.
