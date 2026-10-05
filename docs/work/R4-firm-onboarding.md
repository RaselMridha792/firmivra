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

## Done when

Nahid's N04 form and Fahad's F04 screens complete the flow on dev.

## Needs from others

(none yet)

## Progress log

(newest last: date, step, what changed, commit)
