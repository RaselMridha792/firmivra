# R55: Leads (Octavia's review of Oct 20; CHANGE-LIST section C)

Guide: `docs/specs/review-2026-10-21/leads--developer-review-package.md`; her screenshots in `docs/mockups/firm-workspace/review-2026-10-21/leads/`; designs in `docs/mockups/firm-workspace/leads/source/`. Order (Rasel, Oct 21): after the custom roles PRs, P1 first (L1, L2, L3, L9), then the rest; one PR at a time; L11 (Admin-only deletion) is a server rule under the same guard rules as the custom roles work.

## Reproduced on main (Oct 21, local API and web on origin/main e5a12075, as owner@lvp.test)

- **L1 reproduced.** A lead made with Add New Lead in any status but the four Begin Online ones (New, In Review, Converted, Not Qualified), for example In Follow-Up, answers "We couldn't find this" from its name link, More > View and the Overview tab: `/leads/{id}` rendered the Begin Online request page (`GET /business/leads/{id}`, Begin Online statuses only), and the Overview of the Lead Workspace was never built (the other tabs were, #687). A New lead opened the Begin Online page instead of the workspace.
- **L2 cause found; the dev failure is configuration.** Locally (`SMS_MODE=log`) Send SMS goes out for one and for selected leads (the activity says "Text message sent" and Last Contact moves). On dev, infra sets `SMS_MODE=sns` without `SMS_ORIGINATION_NUMBER` (no registered toll-free number), so the API answers every text 400 `SMS_UNAVAILABLE` ("Text messages are not set up for this firm yet"), and the dialog shows that as "Something went wrong". The dialog also never shows the saved numbers and gives no result after sending.
- **L3 mostly fixed on main.** The Overdue Follow-Ups card counts past-due unfinished follow-ups, its click filters the table, the row says "Overdue: Call …" in red, and the lead keeps its status. Missing: a visible filter when the card is clicked (only "Overdue only" inside More Filters).
- **L9 reproduced.** Convert to Client, Client Details & Services: Full Name, Business Name, Email, Phone and Address, and both Assign Staff pickers, are read-only.

## Items

- [x] L1 (P1): `/leads/{id}` is the Lead Workspace's Overview (individual-lead-profile-lead-workspace.jpg): Contact Information, Lead Details, Next Follow-Up / Lead Score / Interested In, Recent Activity, Upcoming Appointments, Next Action / Follow-Up, Open Tasks, Quick Actions; a Begin Online lead also shows its request with the review actions. Web only.
- [ ] L2 (P1): Send SMS shows each recipient's saved number (and who has none) before sending, says why texts cannot go ("not set up for this firm yet"), and reports sent and not sent per lead. Needs Rasel for dev (below).
- [ ] L3 (P1): a visible Overdue Follow-Ups filter when the card is clicked; future and completed follow-ups never counted (test).
- [ ] L9 (P1): Convert to Client fields editable before completion; carry-forward checked.
- [ ] L4 to L8, L10 to L14: after the P1s.

## Decisions

1. L1: the Overview is built from `api.leadPipeline.profile` and the existing tab cards (Upcoming Appointments, Next Action / Follow-Up and Open Tasks are the same components as their tabs). Lead Score keeps its frame with "Not scored yet" while no scoring exists (contract: optional).

## Needs from others

- **Rasel (infra, dev):** register the toll-free number and set `SMS_ORIGINATION_NUMBER` for the dev API (`infra/src/stacks/app-stack.ts` sets `SMS_MODE: 'sns'` alone); until then every text on dev is refused, whatever the screen does.
- **Contract (later):** a Begin Online lead's answers read only while it is in a Begin Online status (`LeadDetail.status`); once it moves on in the pipeline the Overview says so. Reading them in any status needs `LeadDetail` to allow the pipeline statuses.
