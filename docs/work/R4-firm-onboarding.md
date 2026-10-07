# R4: Firm application and activation (Oct 10)

**Goal:** A firm applies, Super Admin approves, requests info or declines, and the owner activates the workspace.

**Owned paths (change only these):**
- `apps/api/src/firm-applications/**`
- `packages/types/src/firm-applications/**`

**Read first (nothing else):** CLAUDE.md, docs/work/README.md, this file, and:
- docs/specs (Super Admin Phase 1 scope)
- docs/work/R2-staff-auth.md (invites)

## Steps

- [ ] 1. Public application submit (rate limited, no account needed)
- [ ] 2. Super Admin actions: approve, request info (message to applicant), decline with reason; status history
- [ ] 3. Approve creates the business with a unique slug and invites the owner (R2 invite flow)
- [ ] 4. Owner activation ends at first-time setup; business status active
- [ ] 5. Emails through NotifyService (log until R6 merges)
- [ ] 6. Audit every action; e2e test of the whole path
- [ ] 7. Plus T05 (Oct 6): applications list with filters and paging, detail and status history (Super Admin through `forAdmin()`), dashboard counts, firms list (Active, Pending Setup, Inactive). Contract by Oct 8 (Tumit F04b, N04)

## Done when

Nahid's N04 form and Fahad's F04 screens complete the flow on dev.

## Rules

- Contract first for every module (Rasel, Oct 6): the module's first PR is its zod schemas and client functions in `packages/types`, registered on `api` in `apps/web/src/lib/api.ts`, plus typed mock fixtures in `apps/web/src/mocks/<module>.ts`. The developers build the screen against it the same day.
- Never edit screens: in apps/web change only `src/mocks/<module>.ts` and your lines in `src/lib/api.ts`.

## Decisions (Rasel, Oct 7)

- Choice lists (practice types, entity types, services, plans; also client volumes and credential types): one exported list each in `packages/types/src/firm-applications/schemas.ts`, so a change is one line. Octavia confirms them. `REQUIRED_CREDENTIALS` maps each practice type to the credentials it needs; empty until Octavia answers.
- Request Information: email only in Phase 1. The application stays `PENDING_REVIEW`; the message reaches the applicant through R6's email; the applicant replies to Firmivra support; the Super Admin records the answer in the internal notes. Each request is a history entry. No edit link. (The database's `INFO_REQUESTED` status is not used.)
- EIN: an application never stores the full EIN (field encryption is R10 step 2 with each firm's own key, which an applicant doesn't have). It keeps the last 4 and a keyed hash (HMAC, server-side secret) for the duplicate check. The owner enters the full EIN in setup step 2. Nothing waits on R5.
- Step 3: creating the business also creates the firm's KMS key (R10 step 2) and needs a one-time step for LVP. Those change AWS permissions: bring them to Rasel before pushing.

## Needs from others

- R0 (schema): on `firm_applications`, an `ein_last4` column and an indexed `ein_hash` column (keyed hash, for the duplicate check), unless the lead prefers both in `data`. History comes from `audit_logs` (platform rows, `business_id` null), so no new table.
- R1/Rasel (infra): the server-side secret for the EIN hash (dev and prod), before step 1's API.
- R5: uploads for an application before any account exists (the spec's "credentials and uploads"). Until then `documents` is always empty.
- R6: four emails: application received (applicant), information requested (the message; reply-to support), approved (the owner's activation link, through R2's activation mailer), declined. Open: does the decline email include the reason?
- R2: an owner invite created by a Super Admin (no inviting member) through `InvitesService`, checked at step 3.
- Not in the contract (Phase 1 is the approval path only): the "Edit" links on the review cards, "Add Firm Manually", "Add Firm", "Edit Firm Details", "Deactivate Firm" and "Open Firm Workspace" (the last needs the support-access design). The screens leave them out or mark them "Soon".

## Progress log

(newest last: date, step, what changed, commit)

- 2026-10-07, contract (steps 1, 2 and 7): `packages/types/src/firm-applications/` with the public `submit`, and the Super Admin's `list`, `counts`, `get`, `approve`, `requestInfo`, `decline`, `saveNotes`, `resendOwnerInvite`, `listFirms`, `firmCounts`, `getFirm` and `dashboard`. Error codes `APPLICATION_DECIDED`, `SLUG_TAKEN`, `INVITE_NOT_NEEDED`. Mock `apps/web/src/mocks/firm-applications.ts` (fixtures built on first use: three pending, two approved, one declined, plus LVP and a suspended firm), registered as `api.firmApplications`. Tests `packages/types/test/firm-applications/client.test.ts`. Branch `rasel/R4-contract`, on top of #45 (it needs the kit's mock switch).
