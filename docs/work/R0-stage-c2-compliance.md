# Stage C2: Compliance follow-ups (contract note)

Migration `20261018020000_r0_compliance_facts`. It answers the Compliance API's optional schema
follow-ups (#719). This note is for the session that extends the Compliance API:
- applicability rules
- the date engine
- the deadline-to-task link

## Client compliance facts: `client_compliance_facts` (one row per client)

| Field | Notes |
| --- | --- |
| `fiscal_year_end_month`, `fiscal_year_end_day` | together, a real calendar day (Feb up to 29) |
| `tax_classification` | `INDIVIDUAL`, `SOLE_PROPRIETOR`, `DISREGARDED_ENTITY`, `PARTNERSHIP`, `S_CORPORATION`, `C_CORPORATION`, `TRUST`, `ESTATE`, `NONPROFIT`, `OTHER`. How the client is **taxed**, distinct from its legal `entity_type` on the profile |
| `elections` | keys of elections in force, e.g. `s_corp_2553`, `entity_classification_8832` |
| `is_payroll_employer`, `payroll_deposit_schedule`, `payroll_states` | deposit schedule `MONTHLY`, `SEMIWEEKLY`, `NEXT_DAY` or `ANNUAL`, never set for a non-employer; two-letter state codes |
| `is_sales_tax_registered` | plus the registrations below |
| `prior_year_tax_liability_cents`, `prior_year_tax_year` | together; feeds the rules' `prior_year_liability_over_cents` |
| `notes`, `verified_at` (stamped by the database), `verified_by_user_id`, `updated_by_user_id` | |

**Every fact is optional, and unset means unknown.** A rule that needs an unknown fact returns
NEEDS_REVIEW, never a silent deadline (#719). The booleans are nullable for that reason: `false`
is "known not to be", `null` is "not known".

## Sales tax registrations: `client_sales_tax_registrations`

- Columns: state (two letters), filing frequency (`MONTHLY`, `QUARTERLY`, `SEMIANNUAL`, `ANNUAL`),
  the state account's last 4, registered and closed dates.
- At most one open registration per client and state.
- A registration keeps its client and state.
- Closed (`closed_on`), never deleted.

Both client tables are firm data, under the usual firm policy, and each must be on the firm's own
client.

## Holidays: `compliance_holidays`

- **Platform reference data, keyed by jurisdiction and date:** `US` (federal), `US-DC`, `US-CA`...
  Each row is the **observed** date: a Saturday holiday on the Friday before, a Sunday holiday on
  the Monday after. Each also has a name and a source.
- **Who reads and writes:** every scope reads it, including a firm's (its deadline engine moves
  dates); only the Super Admin team (admin scope) or the platform adds or changes it.
- **What ships:**
  - US federal holidays for 2026 and 2027
  - New Year's Day 2028 observed on Dec 31, 2027
  - DC Emancipation Day 2026 and 2027

  These match the API's `federalHolidays()` in `compliance.shared.ts`.
- **Federal tax due dates use `US` and `US-DC` together.** DC Emancipation Day is a legal holiday
  in the District, which moves federal due dates under IRC 7503; the API's code already does this.
  A state deadline adds that state's jurisdiction.
- **Next step for the API:** read this table instead of the hard-coded list, and keep the code
  only as a fallback for years the table doesn't have.

## The due-date sync setting (on `compliance_settings`)

| Column | Meaning |
| --- | --- |
| `task_due_date_sync` | `NONE` (the default; tasks keep their own due dates), `MATCH_DEADLINE`, or `LEAD_DAYS` |
| `task_due_lead_days` | days before the deadline, 0 to 365; only with `LEAD_DAYS` |

When a deadline's due date changes (including an extension), the API moves its linked open tasks
to match the setting, and logs it.

## Endpoints

- `GET`/`PUT /business/clients/:id/compliance/facts`
- `GET`/`POST`/`PATCH /business/clients/:id/compliance/sales-tax` (close with `closedOn`)
- `GET /business/compliance/holidays?jurisdiction=&year=`; admin `POST`/`PATCH`/`DELETE
  /admin/compliance/holidays`
- `PATCH /business/compliance/settings` with the two sync fields

Every change writes `audit_logs` (category `DATA`).
