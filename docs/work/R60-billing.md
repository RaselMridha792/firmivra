# R60: Super Admin Billing (contract and API notes)

Part of `R60-backend.md` (steps 4 and 5). Tables: R0's stage B3 (`docs/work/R0-stage-b3-billing.md`).
Contract: `packages/types/src/admin-billing/` (`createAdminBillingClient`, `api.adminBilling`), under
`/api/v1/admin/billing`.

## Billing contract (step 4)

The screens' mock (`apps/web/src/mocks/admin-billing.ts`, `admin-billing-settings.ts`) set the
method names and most shapes; B3 sets what is stored. Where they differ:

1. **Firmivra bills firms** (Rasel, Oct 17). The mock modelled firms billing their own clients;
   here the firm is the customer and its billing contact is who a document is addressed to. There
   is no client list: `BillingFirm` carries the contact (the billing profile's, else the firm's first
   active owner), its overrides (terms, tax, auto-pay) and its plan. Documents show `billToName` /
   `billToEmail` as saved when they were made. Inputs take `firmId`, never a client id.
2. **USD only**: `BillingCurrency` is `USD` (B3 bills in integer cents of USD).
3. **Invoice statuses** are the page's eight, worked out from the stored five and the money:
   SENT with nothing paid is PENDING; SENT or PARTIALLY_PAID past due with a balance is OVERDUE.
4. **Invoice type** is not modelled (B3), so it is not in the contract. **Payment terms** are not
   stored: an invoice reads the terms its due date matches (null for a custom date).
5. **Tax** is per line in percent (stored as basis points). The settings' single default rate and
   each firm's rate replace the mock's named tax-rate list.
6. **Payment methods** are the database's: CARD (Credit Card), ACH, WIRE (Bank Transfer), CHECK,
   CASH, OTHER (Manual), CREDIT_BALANCE (a credit note's, never recorded by hand).
7. **Refund method**: only ORIGINAL is stored (B3 has no column), so another method is 422
   NOT_SUPPORTED_YET.
8. **Credit notes**: `reason` is stored as the code; an ADJUSTMENT is one line ("Credit
   adjustment"), and `method` reads back from it. `keepAvailable` is the default behaviour (credit
   left stays available), so it is not an input.
9. **Recurring**: `template` is the first line of each invoice (`line_template`), `description` the
   schedule's. `allowOnlinePayment` gives way to B3's `auto_pay`; invoices from a schedule allow
   online payment.
10. **Numbers** come from the database (`INV-`, `EST-`, `CN-`, never reused). `nextNumber` shows the
    next one; the mock's number field and numbering formats are read-only.
11. **History** is the audit log of the record (B4: the team reads every audit row).
12. **Attachments** on invoices are left for later (B3), so they are not in the contract.
13. **Settings**: `general`, `taxes` and the stored JSON `reminders` and `templates` are saved;
    `numbering` is read-only; `preferences` (the page's other options) read their defaults, and a
    change is 422 NOT_SUPPORTED_YET until the database stores them.
14. **Sending**: a document's email goes through NotifyService once Billing has its templates (R6).
    Until then sending issues the document and records `send_error`, so the page shows the send
    as failed, not as sent. Send Receipt and Send Credit Note only email, so they come with the
    templates (no route until then).
15. **No mock** in `api.ts`: the screens keep `mocks/admin-billing.ts` until they switch.

## Billing API (step 5)

16. **Admin scope only** (`AdminPrisma`); every change writes a platform audit row (the firm in the
    metadata), which is also the record's history. Lists and summaries work over the 5,000 most
    recent documents, filtered in memory where the status is worked out (Overdue, Expired).
17. **Totals come from the database**, line by line, so a discount is saved after the lines (a
    discount saved first would take the total below zero); a discount above the subtotal is 400.
18. **Payments** are recorded COMPLETED (idempotent by `requestId`), never past the balance, only on
    a sent invoice; Partial payments off in Settings means only the full balance. **Refunds** are
    recorded by hand (no processor refunds Firmivra's billing yet): created PENDING, then COMPLETED,
    and the database updates the payment and the invoice. A refund type (full or partial) is kept in
    the refund's internal note.
19. **Estimates**: Expired is worked out on read (sent or pending, past the expiration date).
    Convert makes a draft invoice from the lines and marks the estimate CONVERTED.
20. **Recurring schedules** make their invoices when invoices or schedules are read (at most every
    minute per task, one runner at a time, up to 12 per schedule), and Run makes the next one now:
    one invoice per occurrence (B3's unique key), dated on the occurrence, due by the firm's terms,
    for the period up to the next date, sent when the schedule auto-sends.

21. **Voiding a draft**: B3's checks give every invoice that is not a draft a sent time (and every
    credit note an issue time), so a draft is issued without email and voided in one transaction.
22. **Estimate status moves**: a sent estimate never goes back to Draft (409 NOT_A_DRAFT: what was
    quoted is fixed once sent), and leaving Approved for Sent or Pending clears the decision time
    (B3 keeps one only on decided estimates).

## Needs from others

- **R0 (Billing, B3), a bug:** `platform_invoice_recompute` sets PARTIALLY_REFUNDED or REFUNDED
  on any refund, but `platform_invoices_values` allows those statuses only when the invoice is fully
  paid, so refunding a payment on a part-paid invoice fails the check. The API refuses that refund
  (422 NOT_SUPPORTED_YET, "once its invoice is fully paid") until the rule is settled.
- **R0 (Billing, B3), for the record:** the trigger allows DRAFT -> VOIDED for invoices and credit
  notes, but the checks `(status = 'DRAFT') = (sent_at IS NULL)` and
  `(status = 'DRAFT') = (issued_at IS NULL)` refuse it; the API issues a draft first (point 21).
  Leaving APPROVED keeps `decided_at`, which the estimate check refuses; the API clears it.
- **R0 (Billing, B3):** a `preferences` JSON column on `platform_billing_settings` (the settings
  page's other options), `platform_refunds.method`, and later invoice attachments and named tax
  rates if the design keeps them.
- **R6 (notify):** Firmivra's own email templates for invoices, estimates, credit notes, receipts
  and reminders (sender: Firmivra, not a firm).
