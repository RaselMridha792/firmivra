# Super Admin review (Oct 31): Communications change list

Source: "Communications Developer Feedback" (Review One, Oct 31, 2026, through 16:02 UTC) against the Communications Developer Handoff (Oct 14, 9 pages). Her codes are kept (R1, Y1 ...). The review was not mutation-free: Broadcast "Next" created a draft and an authorized Email-only change was saved. Nothing was sent or scheduled.

## Summary

1. F items: 8 (SA-COM-R1 to R8). Y items: 11 (SA-COM-Y1 to Y11). GREEN: 8 checks (G1 to G8), not items. Keep them working and re-test them at Review 2.
2. Her priority 1: recipient controls (R6) and one editor with the same abilities everywhere: attachments (R1, R3), images (R2), merge fields at the cursor (R4), unsaved-change protection (R5). Priority 2: the single-recipient test after R6 (Y1). Priority 3: populated data, state, delivery and audit tests.
3. Keep the retained draft "QA preview only - do not send" (Email only, audience 0, no content). Do not delete, send or schedule it.
4. Schema: none confirmed. To check: `CommMediaLink` already links media to templates and messages with a usage kind (R1 to R3); broadcast recipients may need a manual address without a contact (R6).
5. Role checks: none new; fine-grained Communications roles are deferred in the source (Y11 default).
6. Shared: one editor component for New Message, Templates and Broadcasts (R1 to R4); one merge-token list (R4); unsaved-changes guard (R5); "save and continue" disclosure, same pattern as SA-INT-R1 (R8).

Code map (folders only, verify before use). Web: `apps/web/src/app/admin/(console)/communications/`. API: `apps/api/src/admin-communications/`. DB: `CommConversation`, `CommMessage`, `CommTemplate`, `CommMedia`, `CommMediaLink` (usage kind; template, message or broadcast channel), `CommBroadcast`, `CommBroadcastRecipient`, `CommSegment`.

## A. Editor corrections

| ID | Report | Screen | Observed | Build or fix | Schema? | Seed / role / shared |
| --- | --- | --- | --- | --- | --- | --- |
| SA-COM-R1 | R1 (source pages 7 to 8) | New Message attachments | Disabled; text says direct messages are text-only and files belong in broadcasts. | Enable attachments in New Message with the shared editor's attachment area. Remove the contradictory text. Test allowed types and size errors, draft keeps the files, delivery to the controlled recipient. | No, to check (`CommMediaLink.message_id` and usage kind). | Shared: editor component. |
| SA-COM-R2 | R2 (source pages 6 to 7) | New Message toolbar | No Insert Image. | Add the same Insert Image (upload or library) as Templates; inserts at the cursor; preview and delivered email render it. Inline images stay separate from attachments. | No. | Shared: editor component. |
| SA-COM-R3 | R3 (source page 6) | Template editor | No attachment control; screen sends files to Broadcasts. | Add a separate attachment area to templates. Files save and load with the template, show in preview, and go out as attachments (never converted to inline images). | No, to check (`CommMediaLink.template_id`). | Shared: editor component. |
| SA-COM-R4 | R4 (source pages 5, 7, 8) | New Message Merge Field button | Inserts `contact.first_name` into the BODY at once, no chooser. Templates has a six-field chooser. | One central token list used by both. The button opens the chooser and inserts the chosen token at the cursor of the active field (Subject or Body). Preview fills sample values; a missing value uses the agreed fallback (empty, no raw token). Test every token. | No. | Shared: token list and chooser. |
| SA-COM-R5 | R5 (source pages 6, 8) | New Message > Cancel | Leaves for Inbox with no warning after a recipient and a body token were added. | When there are unsaved edits (recipient, subject, body, image, attachment), Cancel, in-app links and browser Back ask "Discard this message?" with Keep editing and Discard. Keep editing keeps everything; Discard sends nothing. | No. | Shared: unsaved-changes guard (reuse the firm-side one if it exists in `packages/ui`). |

## B. Broadcast corrections

| ID | Report | Screen | Observed | Build or fix | Schema? | Seed / role / shared |
| --- | --- | --- | --- | --- | --- | --- |
| SA-COM-R6 | R6 | Broadcast > Audience > Select Individually; Advanced Filters | Static instructions only: no picker, search or manual address. Advanced Filters has no filter controls. The approved test address could not be found or added. | Searchable picker over firm contacts and team members, plus "Add email address" for a validated manual address (marked as manual). Advanced Filters with real controls (plan, firm status, role, signup date). Show selected recipients and an accurate count. A single approved recipient can be selected; everyone else is excluded. | To check: `CommBroadcastRecipient` must accept a manual address with no contact record. | Seed: the controlled QA recipient as a selectable contact (set M). |
| SA-COM-R7 | R7 (source page 3) | Broadcast list | A narrow legacy "Create New Broadcast" sidebar with Email/SMS-only wording remains. | Remove the legacy entry. Every "Create Broadcast" opens the full-width four-step wizard and names all three channels (Email, SMS, In-App). | No. | None. |
| SA-COM-R8 | R8 | Broadcast wizard > Basic Information > Next | Next silently created a saved draft, beside a separate Save As Draft. | Label the button "Save and continue" (or show "Draft saved" with time after Next). Save As Draft saves and exits. Leaving a saved draft keeps it; leaving an unsaved new one asks first. Next never creates a second draft for the same broadcast. | No. | Shared: same pattern as SA-INT-R1. |

## C. Y items: Review 2 tests (her Y1 to Y11)

Fixtures are dummy data sets G and M in CHANGE-LIST.md. No send without explicit approval of content and action for that test.

| ID | Report | Item | What we supply and default |
| --- | --- | --- | --- |
| SA-COM-Y1 | Y1 | Controlled email test | After R6: the controlled QA recipient is seeded as a contact; Email only, exactly one recipient; after approval of content and send, check receipt, formatting, attachments, sender, history and audit. A test send never marks the broadcast Sent. |
| SA-COM-Y2 | Y2 | Audience and progression | Seeded segments and individuals; create a segment and return to Audience with it selected; zero-audience send blocked; Back keeps entries. |
| SA-COM-Y3 | Y3 | Message and Review stages | Email formatting, tokens, images, attachments, preview; SMS and In-App editors; Review lists channels, audience count, content, attachments and timing. |
| SA-COM-Y4 | Y4 | Send and schedule | Delivery-disabled sandbox: destination checks, large-send confirmation, duplicate-submit protection, timezone and DST (Nov 1, 2026), cancel before dispatch, edits locked once dispatch starts. |
| SA-COM-Y5 | Y5 | State-aware actions | Seed Draft, Scheduled, Sent, Failed and partly delivered broadcasts (synthetic results); check each state's menu; Sent cannot be edited or deleted. |
| SA-COM-Y6 | Y6 | Failure and history | Synthetic failed and partial results per recipient and channel; retry only failed destinations; never report full success when a channel failed. |
| SA-COM-Y7 | Y7 | Conversation records | Seed Email, SMS and Internal conversations across unread, open, waiting, assigned and mention states; check KPIs, filters, sorting, paging and unread styling. |
| SA-COM-Y8 | Y8 | Thread and contact actions | Replies, internal notes, assign and unassign, related links, tags, Recent Activity; sent messages cannot be edited destructively. |
| SA-COM-Y9 | Y9 | Template lifecycle | Seed templates in each category and status; save, load, edit, preview, duplicate, archive; load into New Message and edit per send without changing the template. No raw token leaks. |
| SA-COM-Y10 | Y10 | Files and images | Safe fixture files of each allowed type plus a too-large and a wrong-type file; check limits on the server, not just the 5 MB label. |
| SA-COM-Y11 | Y11 | Deferred roles; template ownership | Default: this round only Super Admin sends messages and broadcasts and edits shared templates; team members can read templates. Fine-grained roles stay deferred. |

## D. Schema needs

None confirmed. To check before building: `CommMediaLink` usage kinds cover inline image vs attachment for templates and messages (R1 to R3); `CommBroadcastRecipient` with a manual address and no contact (R6).

## E. Role and permission notes

No role change. Default send and template-edit rights per Y11.
