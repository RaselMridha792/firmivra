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
    as failed, not as sent.
15. **No mock** in `api.ts`: the screens keep `mocks/admin-billing.ts` until they switch.

## Needs from others

- **R0 (Billing, B3):** a `preferences` JSON column on `platform_billing_settings` (the settings
  page's other options), `platform_refunds.method`, and later invoice attachments and named tax
  rates if the design keeps them.
- **R6 (notify):** Firmivra's own email templates for invoices, estimates, credit notes, receipts
  and reminders (sender: Firmivra, not a firm).
