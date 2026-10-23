# R55: Leads (Octavia's review of Oct 20; CHANGE-LIST section C)

Guide: `docs/specs/review-2026-10-21/leads--developer-review-package.md`; her screenshots in `docs/mockups/firm-workspace/review-2026-10-21/leads/`; designs in `docs/mockups/firm-workspace/leads/source/`. Order (Rasel, Oct 21): after the custom roles PRs, P1 first (L1, L2, L3, L9), then the rest; one PR at a time; L11 (Admin-only deletion) is a server rule under the same guard rules as the custom roles work.

## Reproduced on main (Oct 21, local API and web on origin/main e5a12075, as owner@lvp.test)

- **L1 reproduced.** A lead made with Add New Lead in any status but the four Begin Online ones (New, In Review, Converted, Not Qualified), for example In Follow-Up, answers "We couldn't find this" from its name link, More > View and the Overview tab: `/leads/{id}` rendered the Begin Online request page (`GET /business/leads/{id}`, Begin Online statuses only), and the Overview of the Lead Workspace was never built (the other tabs were, #687). A New lead opened the Begin Online page instead of the workspace.
- **L2 cause found; the dev failure is configuration.** Locally (`SMS_MODE=log`) Send SMS goes out for one and for selected leads (the activity says "Text message sent" and Last Contact moves). On dev, infra sets `SMS_MODE=sns` without `SMS_ORIGINATION_NUMBER` (no registered toll-free number), so the API answers every text 400 `SMS_UNAVAILABLE` ("Text messages are not set up for this firm yet"), and the dialog shows that as "Something went wrong". The dialog also never shows the saved numbers and gives no result after sending.
- **L3 mostly fixed on main.** The Overdue Follow-Ups card counts past-due unfinished follow-ups, its click filters the table, the row says "Overdue: Call …" in red, and the lead keeps its status. Missing: a visible filter when the card is clicked (only "Overdue only" inside More Filters).
- **L9 reproduced.** Convert to Client, Client Details & Services: Full Name, Business Name, Email, Phone and Address, and both Assign Staff pickers, are read-only.

## Items

- [x] L1 (P1): `/leads/{id}` is the Lead Workspace's Overview (individual-lead-profile-lead-workspace.jpg): Contact Information, Lead Details, Next Follow-Up / Lead Score / Interested In, Recent Activity, Upcoming Appointments, Next Action / Follow-Up, Open Tasks, Quick Actions; a Begin Online lead also shows its request with the review actions. Web only.
- [x] L2 (P1): the composer (row, selected leads, the lead's page) lists each recipient's saved number or address before sending, leaves out a lead with no phone (Send is off when nobody has one), and after sending says how many went and why the others did not; `SMS_UNAVAILABLE` reads "Text messages are not set up for this firm yet, so nothing was sent". Texts on dev still need the number (Needs, Rasel). Delivery to a real phone is untested until then.
- [x] L3 (P1): the card turns on a visible "Overdue Follow-Ups" chip (remove to clear; More Filters keeps its checkbox), and the filter now combines with a status instead of clearing it. The API already counts only open leads' past-due, unfinished follow-ups (closing a lead clears its follow-up); the mock now does the same. With the API unreachable the Leads page keeps every frame (the cards show a dash, the filters stay, the table says why with Try again) instead of one error panel per section.
- [ ] L9 (P1): Convert to Client fields editable before completion; carry-forward checked.
- [ ] L4 to L8, L10 to L14: after the P1s.

## L4: the email composer (Oct 23)

- **Reproduced on main:** the lead email was plain text from start to finish (a textarea, `body` escaped into one paragraph). `message_signatures` existed but nothing read or wrote it, and nothing could store an email image.
- **Decided (Rasel, Oct 23):**
  - font, size and image controls go into `packages/ui`'s RichTextEditor as opt-in props;
  - inline images use a public URL under the firm's portal, not CID attachments, so there's no transport or infra change;
  - the signature is per member;
  - L4 comes before the P2s.
- **Contract #1042, API #1044** (stacked on #1042):
  - the HTML cleaner `notify/email-html.ts`;
  - `GET`/`PUT /business/me/message-signature`;
  - `POST /business/leads/messages/images` and `/confirm`;
  - the public `GET /portal/{slug}/email-images/{id}.{ext}`;
  - `html` on Send Email.
- **Web** (`rasel/R55-leads-email-web`, stacked on #1044):
  - Font and Size menus, bold and italic, image upload, then click the image to set its width (24 to 600 px), place it left, centre or right, or remove it; no link button;
  - the saved signature sits under a new email and can be created, edited, given the firm's logo, or inserted again;
  - `body` is the plain form of the same message.
- **Live, Oct 23 (local API, web, Mailpit, owner@lvp.test):**
  - the delivered email kept Georgia 20 px bold, italic, the image centred at 200 px (loaded from its public address) and the signature with the LVP logo;
  - the text part had each line;
  - the activity says "Email sent: <subject>".
  - Screenshots: `apps/web/e2e/mock/r55-screenshots/leads/email-*.png`.

## Decisions

1. L1: the Overview is built from `api.leadPipeline.profile` and the existing tab cards (Upcoming Appointments, Next Action / Follow-Up and Open Tasks are the same components as their tabs). Lead Score keeps its frame with "Not scored yet" while no scoring exists (contract: optional).

## Needs from others

- **Rasel (infra, dev):** register the toll-free number and set `SMS_ORIGINATION_NUMBER` for the dev API (`infra/src/stacks/app-stack.ts` sets `SMS_MODE: 'sns'` alone); until then every text on dev is refused, whatever the screen does.
- **Contract (later):** a Begin Online lead's answers read only while it is in a Begin Online status (`LeadDetail.status`); once it moves on in the pipeline the Overview says so. Reading them in any status needs `LeadDetail` to allow the pipeline statuses.
