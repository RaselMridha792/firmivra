# Invoices & Payments: Review 2 QA map

This file maps the rows of Octavia's Invoices & Payments Review Two (Nov 2026) and its checklist (the report is kept privately, outside the repo): sections A2, A3 and A6 (I-N01 to I-N10, I-P01 to I-P03, I-D01), I-C02 and section C (R1-1 to R1-4). For each row it names the PR that fixed it and the test that covers it, or marks it as a **GAP** or as open.

Rows are named by their IDs and headings only; the report's text is not copied here. A row says Done only when the test named beside it proves it. **Open** means the work is planned in a later batch; **Her retest** means the code is on main and she checks it on dev.

**Where the tests are**
- API e2e: `apps/api/test/e2e/`
- Mock specs: `apps/web/e2e/mock/`
- Design system unit tests: `packages/ui/src/*.test.tsx`
- Database tests: `packages/db/test/`
- Isolation: `apps/api/test/isolation/cases/invoices.ts`

## Batch 1: small fixes (R55)

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| I-N07 Distinct status badges (Overdue / Canceled, Due Today / Partially Paid, Scheduled / Sent; Draft apart from Canceled) | Done: two new Badge tones in `packages/ui`, teal for Scheduled (beside Sent's blue) and solid navy for Canceled (beside Overdue's red and Draft's grey). Each tone reads at 4.5:1 or more (teal 5.42:1, white on navy 10.98:1). Draft and Not Sent share grey, as she accepted. The firm's list, the client's Invoices tab, the client portal and the Client Portal record use them | #PR_NUM | `badge.test` "R55 I-N07: Scheduled teal and Canceled navy use their own fixed tokens", "every tone reads at 4.5:1 or more, text on its background", "the tones a pair of invoice statuses uses differ in both colours"; mock `r1-invoices-b2` "I-N07: Overdue and Canceled, Due Today and Partially Paid, Scheduled and Sent read apart"; mock `r55-invoices-review2` "I-N07: the client portal shows Canceled in the same solid navy as the firm" |
| I-D01 Remove the payment-before-due option (withdrawn) | Done: gone from Settings > Payments, Create Invoice (option, hint and preview), the invoice page and the client portal. The API still accepts the field, because requests are strict and an older screen sends it, but ignores it on create, update and the settings save; a stored value changes nothing and is shown nowhere. Both columns stay. Paying early stays possible | #PR_NUM | `invoice-options.e2e` "I-D01: payment before the due date is withdrawn: still accepted, never written"; `payment-preferences.e2e` "I-D01: a save ignores payment before the due date (withdrawn); an older screen still saves"; mock `r55-invoice-options` "nothing on to start; the tip follows Settings, and nothing asks for payment before the due date"; mock `r55-invoices-review2` "I-D01: an invoice set to ask for payment before the due date asks for nothing, in the firm or the portal" |
| R1-2 Unsaved changes on Settings > Payments ask to stay or leave | Done for links in the app and for closing or reloading the tab, on Accepted Client Payments and the billing sections (the guard Client Portal settings use). The mock firm connects Stripe for that spec only, so the cards switch can change | #PR_NUM | mock `r55-invoices-review2` "R1-2: leaving Accepted Client Payments with unsaved changes asks to stay or leave", "R1-2: the billing sections ask too; after Cancel nothing is asked" |
| R1-2: the browser's own Back button | **GAP**: not asked, as on every screen of the app (the App Router cannot stop it). Plan: none in this batch; it needs one shared answer for every form | — | none |
| I-C02 Auto-apply payments does what it says | Done (lead's choice a): the switch stays and says "Not active yet" with one line on what it will do; nothing applies payments yet. Building it waits for Octavia (through the lead) | #PR_NUM | mock `r55-invoices-review2` "I-C02: Auto-apply payments says it is not active yet, and still saves" |
| I-N04 follow-up: the reminder schedule shows while its switch is off | Done: the days before the due date, Repeat every and Stop after show greyed while their switch is off. They keep the saved values, and turning a switch off puts back what is saved, so nothing unsaved goes with a save | #PR_NUM | mock `r55-invoices-review2` "I-N04: the reminder and overdue fields show greyed while their switch is off, and keep what is saved" |

## Done before batch 1

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| I-N02 Every term counts from Send On | Done | #1561 (R60) | mock `r55-invoice-terms-notes` "I-N02: every term counts from Send On, and follows it; a typed due date is a custom one" |
| I-N04 (and I-C02's sending) Reminders before the due date and overdue notices | Done | #1578 (db), #1582 (R60) | `invoice-jobs.e2e` "nothing before 9:00 in the firm; then each step once, with its event, step and due date"; `payment-preferences.e2e` "I-N04: reminds on several days before the due date and stops overdue notices at a cap"; mock `r55-payment-preferences` "I-N04: reminders on several days before the due date, and a cap on overdue notices" |
| I-N06 Edit a scheduled or sent invoice with nothing paid | Done | #1567 (db), #1570 (R1) | `invoice-edit.e2e` "needs a reason, keeps its number, and the reason and amounts go in the audit and history", "with a payment on it (partly paid), or paid or canceled, it stays as it is: 409"; mock `r1-invoice-edit` "a sent unpaid invoice is edited with a reason, kept in its History" |
| I-N08 Preview on screen | Done | #1581 (R1) | mock `r1-invoices-b2` "I-N08: Preview opens the invoice on screen, from the list and from the invoice" |
| I-N09 Invoice Templates link | Done | #1581 (R1) | mock `r1-invoices-b2` "I-N09: Invoice Templates opens the invoice templates, and Back returns to Invoices" |
| I-N10 Payment Method filter | Done | #1581 (R1) | mock `r1-invoices-b2` "I-N10: the Payment Method filter lists the invoices paid that way (a voided payment does not count)" |
| I-P03 Send receipt starts ticked | Done | #1581 (R1) | mock `r1-invoices-b2` "I-P03: Record Payment starts with Send receipt ticked, and it can be unticked" |

## Open or waiting

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| I-N03 Send to Client on the invoice page; Send Now for a Scheduled invoice | Open: Batch 2 (the lead chose Send Now) | — | none yet |
| I-N05 Firm toggle for tips | Her retest for the toggle (labelled "Not active yet"); the tip at Pay Now is R1-4 | #1239, #1581 (R1) | mock `r1-invoices-b2` "I-N05: the Tipping setting says tips are not active yet at Pay Now" (the label only) |
| R1-4 A tip charged at Pay Now | Open: the tip plan, after the db PR for the refund cap | — | none yet |
| I-N01 Header Service with a dependent plan | Open: Batch 5 (plan names from the catalog) | #1581 (R1) for the catalog list | mock `r1-invoices-b2` "I-N01: the header Service lists the whole catalog; one the client lacks is added as Requested, with its plans" (the list only) |
| I-P01, I-P02 Create Task and Schedule Follow-Up open with the client | Her retest on dev | #1581 (R1) | mock `r1-invoices-b2` "I-P01/I-P02: Create Task and Schedule Follow-Up open with the invoice’s client filled in" |
| R1-1 Payout provider selector | Blocked until Square or PayPal exist (Rasel's provider decision) | — | none |
| R1-3 Prior-year invoices on dev | Rasel (`packages/db` seed) | — | none |
