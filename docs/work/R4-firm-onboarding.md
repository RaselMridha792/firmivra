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

## Needs from others

(none yet)

## Progress log

(newest last: date, step, what changed, commit)
