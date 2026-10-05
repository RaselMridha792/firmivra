# R0: Full Phase 1 schema (Oct 6-8)

**Goal:** Every table Phase 1 needs exists with row-level security, so developers never wait for a table.

**Owned paths (change only these):**
- `packages/db/**`

**Read first (nothing else):** CLAUDE.md, docs/work/README.md, this file, and:
- docs/AUTH-DESIGN.md (data section)
- Developers' field lists (T01, I01 issues or messages, due Oct 6)
- Existing schema and the RLS coverage test in packages/db

## Steps

- [ ] 1. Read the current schema and RLS helpers; list the tables that already exist in the Progress log
- [ ] 2. Business settings, firm legal documents (Terms, Privacy per firm), tax statuses (firm-defined), team invites
- [ ] 3. Clients and client profiles, client account status (pending, approved, declined), client tax status history
- [ ] 4. Services and engagements (active, recurring, completed, cancelled), service workspaces (Bookkeeping, Tax Planning: tasks, notes, reports)
- [ ] 5. Documents, document categories, document requests
- [ ] 6. Intake form definitions and submissions (6 Begin Online services), leads
- [ ] 7. Notifications (per user, read/unread, link to record), notification preferences
- [ ] 8. Appointments, staff availability, working hours, blocked time (unique constraint that blocks double booking)
- [ ] 9. Message threads, messages, firm notes
- [ ] 10. Invoices, invoice lines, payments (Stripe ids), external links, calculator definitions
- [ ] 11. Firm applications (if not already there) and support access grants (already there: check)
- [ ] 12. RLS policy + grant for every new table; the coverage test passes; LVP seed data covers every table
- [ ] 13. Generate Prisma client and export types in packages/types; PR per two or three groups so developers get tables early (first PR by Oct 7 morning: business settings, team, tax statuses, clients)

## Done when

All tables merged on main by Oct 8, RLS coverage test green, seed loads.

## Needs from others

(none yet)

## Progress log

(newest last: date, step, what changed, commit)
