# Messages: developer review (Octavia, Oct 27)

Source: Firmivra_Messages_Developer_Review.docx, converted to text with its table rows kept. The change list is `CHANGE-LIST.md`. MSG-001 to MSG-082 refer to the findings in this guide. Every success in it is user-reported and narrow.

| Firmivra Messages developer review |

| Review brief | Developer handoff |
| Purpose | Correct the confirmed Messages gaps, preserve the narrowly working behavior, and complete prerequisite-based retesting before acceptance. This is a focused feedback package, not a replacement for the full developer instructions. |
| Current conclusion | The existing inbox and several basic interactions work in the reported scenarios. Required navigation, compose controls, contact context and bulk entry remain incomplete. Full module acceptance is not established. |
| Evidence baseline | 27 October 2026. Ten supplied text excerpts cover source sections 1 to 24. Finding IDs refer to the review ledger through MSG-082. UI results are user-reported, not independently verified. Source sections read does not mean all requirements tested. |
| Scope boundary | Messages and its entry integrations only. Deep Communications and Templates reviews were explicitly deferred. No actual external send, call or booking, provider delivery, tenant isolation or security outcome is passed. Reference-frame visual fidelity remains unverified. |

| Status | Meaning |
| GREEN  WORKING | User-reported PASS only for the specific observation and stated limits. Not a whole-feature or backend certification. |
| RED  CORRECTION | Confirmed missing behavior or UI, routing/style correction, or explicitly requested addition. Each row distinguishes user additions from source requirements. |
| YELLOW  PENDING | The row states whether it is BLOCKED, UNTESTED, USER DEFERRED or DEVELOPER CONFIRMATION. Pending is neither a failure nor a pass. |
| NEUTRAL  CONTEXT | A design decision, observation or supersession note. Not a tested functional result. |

| Suggested order | Action and completion evidence |
| 1  Restore entry points | Implement Messages Settings, the thread menu, correct bulk audience entry and message-scoped Templates. Verify canonical routing and return context before downstream testing. |
| 2  Complete core interactions | Correct full email/phone search, missing tabs, contact context and compose/reply controls. Retest against the specific correction rows; do not repeat resolved findings as new defects. |
| 3  Validate safe operation | Use controlled records, configured providers and authorized roles to prove eligibility, history, state handling, isolation and idempotent delivery. Obtain explicit authorization before any live send, call, booking or dispatch. |
| Preserve decisions | Keep one shared Messages workspace. Keep the extra Documents view. Use Open Client for canonical master-profile edits, not inline Edit. Preserve narrow green checks while fixing red items. |

| What is working |

| WORKING
Evidence | User reported observation | Limit of the green result |
| ✓ MSG-008 012 078 | Search is visible; an existing client-name query narrows results; clearing restores the list; a known message word finds the correct conversation. | Only these cases pass. Full email/phone fail separately. Business/lead-name searches and format variants remain untested. MSG-078 retracts MSG-077. |
| ✓ MSG-016 020 | History shows sender and time. Conversation list shows sender, time/date and preview. | Presence only; context tags, complete historical metadata and unread counts are not proven. |
| ✓ MSG-023 055 | Contact panel shows name/status, Open Client, Call, Email, Schedule, phone, email, location, Client Since/date, Notes and Add Note. | Presence only. Field correctness, permission scope and untested actions are not certified. |
| ✓ MSG-024 026 | New Message is gold. Active tabs are blue. | Color observations only; Bulk/Templates styling is a separate correction. |
| ✓ MSG-030 | Invoices and Documents retain the same Messages layout and show empty lists. | Shared layout only. Empty lists do not prove accurate filtering. Newest-first conversation-list order is user-approved. |
| ✓ MSG-037 038 080 | New Message opens a modal. Client selector, Subject, Message, Send Message and Cancel are visible. Selected test-client name is correct. | Opening, field presence and one selection only. Cancel behavior, recipient search and send are not passed. |
| ✓ MSG-046 | Send is disabled when recipient and body are both blank. | Combined-empty state only; recipient-only/body-only validation and subject rules are untested. No send occurred. |
| ✓ MSG-047 048 | Thread history is oldest at top, newest at bottom. Reply box remains available while scrolling without reported overlap or jumps. | Observed history order and one scroll scenario only. |
| ✓ MSG-049 054 | Add Note saves inline in the correct context; the same note remains after refresh. | Save and observed refresh persistence only. Internal-only privacy, role access and delivery isolation need developer evidence. |
| ✓ MSG-050 052 | Call opens the OS FaceTime handler. Email opens with the correct client email prefilled. | Handler launch and email prefill only. Correct call number and actual calls/email delivery were not tested. |
| ✓ MSG-071 072 | Escape closes New Message without sending. Tab displays visible focus. | No unsaved-content preservation/warning, complete tab order or full accessibility audit is passed. |
| ✓ MSG-073 074 | At the tested narrow browser width, list/thread/contact remain accessible without overlap. Messages is highlighted in the sidebar. | One viewport only. Full device/browser matrix and all 24 sidebar labels/order remain untested. |
| ✓ MSG-075 079 | Open Client opens the correct client Overview. Switching two existing threads updates header, history and contact card correctly. | Canonical destination and two-thread synchronization only. Profile return is missing; master-profile editing permissions remain untested. |

| Corrections to inbox and entry routing |

| CORRECTION
Evidence and source | Observed gap | Required correction and retest |
| MSG-081 082
Sections 1 12 | Full known-contact email and phone inputs do not find the conversation, explicitly confirmed by the user. | Implement email matching and phone normalization over permitted contacts/conversations. Retest the reported full inputs, then documented variants. Do not imply variants or exact normalization were exhaustively tested. |
| MSG-002
Sections 1 2 12 19 | Settings is absent from the Messages header; only New Message, Send Bulk Message and Message Templates are present. | Add a blue/neutral Messages Settings entry routed to message-specific settings. Deeper settings remain blocked until the entry exists, not individually failed. |
| MSG-018
Sections 3 12 | Clients, Leads, Automations and Archived tabs are absent. All Messages and Unread are present. | Add the four required filtered views on the shared conversation dataset. Preserve permitted scope and history. Documents may remain as an additional user-supported view. |
| MSG-025
Section 2 | Bulk and Templates appear white/outline rather than the required blue styling; exact outline hue was not established. | Align both with the required blue secondary-action styling. Verify readable labels, contrast and consistent states without changing the gold primary action. |
| MSG-032
User addition | The requested Filter control beside Search is missing. | Add a distinct, accessible Filter control beside Search. The exact button and placement are the user requirement, not verbatim source section 1. Verify filter state and clearing. |
| MSG-059
Sections 8 12 15 | Send Bulk Message opens general Communications. Clicking Bulk Campaign opens no audience form/list. | Deep-link to a functioning Messages bulk audience builder and retain Messages context. Required flow is Audience to Message to Review to Send; downstream behavior stays blocked until reachable. Replaces MSG-003 uncertainty. |
| MSG-060
Sections 8 12 18 20 | Message Templates opens broader Communication Campaign ALL types, not message-filtered content. | Open the shared Templates library with message-specific scope/filter and usable return context. The canonical Templates destination itself is not a defect. Replaces MSG-004 uncertainty. |
| MSG-005 011 076
Section 12 and user requirement | No contextual Back to Messages was initially reported off-module. Templates and Open Client absence are specifically confirmed. | Provide a prominent Back to Messages that restores selected thread, list, filters and search. Near Create Template is suggested placement, not an immutable spec. Dynamic Back to origin is user-requested; Bulk return had no separate later retest. |

| Corrections to compose and reply |

| CORRECTION
Evidence and source | Observed gap | Required correction and retest |
| MSG-040 065
Sections 4 13 | Only one Choose Client selection; no Leads, multi-recipient selection, recipient count or Clear All. | Support authorized Clients, Leads and Both, multi-select, count and Clear All. Verify correct selected identities and permitted scope. Other permitted-contact support remains unverified, not an additional confirmed failure. |
| MSG-041 021
Sections 4 5 13 14 | No New Message channel selector; no Email/SMS/In-App channel indicator anywhere in chat. | Show configured, eligible channels with unavailable reasons where applicable; show active channel appropriate to the supported model. Confirm multichannel applicability. Visible absence does not prove backend channel metadata loss. |
| MSG-042 063
Sections 5 13 14 | No New Message template option; reply template and emoji controls are absent. | Add permitted shared message templates and reply controls. Templates must respect channel/category/service and remain editable after use. Do not infer provider availability or downstream application success. |
| MSG-043 022
Sections 4 5 13 14 | Both New Message and reply lack attachment controls; reply shows Send only. | Add permission/channel-aware attachment affordances. Validate type, size, upload/download access and secure handling. If a restriction is intended, document it; do not claim the controls exist. |
| MSG-044
Sections 4 13 14 | No related-record linking in New Message. | Add Related To for canonical appointment, invoice/payment, return, document request, task and relevant service records. Preserve identity/context without duplicate master records. Linked-view accuracy must be tested separately. |
| MSG-045 066
Sections 13 14 23 | No Save Draft or Schedule/date/time controls. | Add draft save/reopen preserving recipients, channel, content/options. Add future date/time with documented timezone and authorized edit/cancel before dispatch. Persistence and queue behavior remain blocked until implemented. |
| MSG-067 070
Sections 13 14 | Editor has no Review/Preview stage and no Merge Field insert button. | Add approved-field insertion and review of recipients, eligibility, channel, subject/body, attachments, merge resolution, timing and warnings. Resolve per recipient; warn/block unresolved fields. No send has been tested. |
| MSG-068 069
Section 13 | No Assign Staff or Add to Client Timeline options. | Add permitted staff assignment and timeline option with canonical history association. Verify authorized staff scope and correct client/thread linkage. |
| MSG-064
Sections 5 21 | No visible Sent, Delivered, Read or Failed labels. | Display supported actual delivery/read states and safe errors. Do not fabricate Read for unsupported channels. Provider support, actual outcomes and retry behavior are unverified. |

| Corrections to contact context and thread actions |

| CORRECTION
Evidence and source | Observed gap | Required correction and retest |
| MSG-033
Sections 1 6 | Recent Activity is missing; Notes is present. | Add permitted appointments, messages, forms, invoices, documents and other recent activity with canonical links. Notes is not a substitute. |
| MSG-056 057
Section 6 | Tags and Assigned Staff displays are absent. | Show tags and applicable assigned staff, with clear empty/unassigned states. Do not invent tag values or assume an assignment exists. |
| MSG-051
Section 6 | Schedule opens without the current client preselected. | Prefill the selected contact in the canonical appointment workflow; retain thread/related context and Back to Messages. Retest open/cancel safely. No appointment creation is passed. |
| MSG-028
User addition and sections 4 13 14 | No contextual Send Message action is available on the appointment. | Provide the requested appointment Send Message entry with client preselected and appointment in Related To, or a clear composer linking path. Reuse the canonical record; do not duplicate it. |
| MSG-035
Section 7 and user placement | Three-dot Thread Actions menu is confirmed missing beside the selected-conversation client review card. | Add View Profile; Mark Read/Unread; Assign/Reassign Staff; Tags; Create Task; Schedule Appointment; Mute/Unmute; Archive/Restore. Menu placement is user-requested. MSG-035 replaces MSG-034 uncertainty. |

| Status | Implementation boundary and acceptance check |
| RED  CORRECTION | The five rows above record missing UI/context. Do not count the eight unavailable thread actions as eight proven behavior failures. |
| YELLOW  BLOCKED
MSG-036 | Once the menu exists: verify canonical profile; read/unread state and counters; authorized owner/queue; searchable tags; task contact/thread prefill; appointment contact prefill; mute internal alerts only while messages still arrive; unmute; archive/restore preserving full history. Optional mute duration is not mandatory. |
| NEUTRAL  DESIGN
MSG-058 075 076 | Do not add inline Edit. The approved route is Open Client to the canonical master profile for authorized edits, then Back to the same Messages thread. Correct profile destination passed narrowly; return is a confirmed red gap; edit permissions remain untested. |
| NEUTRAL  OBSERVATION
MSG-001 014 061 | Messages heading/subtitle was observed, not a functional pass. Extra Documents view may remain. Templates shows Create Template plus SMS/category/status Active/Draft/Archive/Owner/Tag/Sort list controls; these are not Create Template form fields or a creation/manage pass. |

| Blocked checks and prerequisites |

| Status and reference | Check not yet established | Required prerequisite and evidence |
| YELLOW  BLOCKED
MSG-019 027 029 031 | Unread dot/count and correct Appointments, Invoices/Documents memberships. | Use authorized unread incoming and canonical linked-record fixtures. Verify incoming read-state counters and correct memberships without duplicates. Empty views are not failures. Invoice payment scope remains unverified. |
| YELLOW  BLOCKED
Sections 5 12 | Action cards such as Book Appointment, Pay Invoice and Upload Documents; secure attachment-card preview/download. | Obtain suitable authorized existing cards/attachments or approved controlled fixtures. No applicable fixture was established. Verify safe open/cancel, contact/record prefill and permissions; do not create/send messages merely to manufacture evidence. |
| YELLOW  BLOCKED
Sections 13 14 | Full compose review, templates, attachments, merge resolution, draft persistence, scheduling and related-record behavior. | Implement the red controls first. Supply configured eligible channels, permitted test recipients, templates and records. Verify subject rules, draft options, timezone/edit/cancel and partial-failure retry without duplicating successful deliveries. |
| YELLOW  BLOCKED
Sections 15 16 | Messages bulk Audience to Message to Review to Send; canonical audience filters. | Restore the audience entry. Verify Clients/Leads/Both, services, payroll/return status, entity, state/jurisdiction, tags, staff, last contact, client-since/date-added, consent, portal access and approved custom fields against canonical sources. Do not substitute general campaigns. |
| YELLOW  BLOCKED
Section 17 | Bulk counts, exclusions, selection and delivery safeguards. | With an implemented controlled flow, prove Total/Can Receive/Cannot Receive and safe reasons; authorized include/exclude; documented dedupe; suppression; count/content preview; configurable high-volume confirmation; throttling; campaign+recipient+channel idempotency; failed-only retry; separately permitted minimized export. Completion alert is optional. |
| YELLOW  BLOCKED
Section 19 | Individual Messages settings and provider routes. | Add Settings first, then verify channels; Integrations for credentials; sender/signatures; notification types; supported receipts; retention/archive; attachment limits; consent/suppression. Assignment rules, quiet hours and bulk thresholds apply where supported/optional. Do not presume every setting individually absent. |
| YELLOW  USER DEFERRED
MSG-062 Sections 18 20 | Deep Communications campaign/automation and Templates form/create/manage review. | Resume only under the separate module review. Messages entry routing/filter defects remain actionable now. No template schema, preview, edit/duplicate/archive, ownership/resources or campaign behavior is passed or failed from the observed list controls. |
| YELLOW  BLOCKED
Section 11 | Visual comparison to the three approved frames. | Supply the overview, New Message and bulk audience-builder reference images. Original frame appearance and layout fidelity were not verified. The behavior requirements remain usable independently. |

| Untested checks and developer evidence |

| Status and reference | Exact remaining check | Evidence needed before closure |
| YELLOW  UNTESTED
MSG-010 015 Sections 1 3 | Business and lead-name search; email/phone formatting variants; list context tags; exact Invoices label/payment coverage. | Test known authorized values and inspect the relevant label/data. Keep name, known-word and clear passes narrow. These checks are not blocked merely because they have not been performed. |
| YELLOW  UNTESTED
MSG-006 Sections 4 13 | Cancel behavior and origin context; client-selector search; recipient-only/body-only validation; subject rules; unsaved-content warning/preservation. | Use harmless unsent content and a safe dismissal/validation plan. Cancel was visible but never explicitly confirmed. Escape passed only dismissal without send. Other permitted-contact selection and compose read-receipt applicability are unverified. |
| YELLOW  UNTESTED
Sections 9 11 12 23 | All 24 sidebar labels/order; decorative cursive copy; broader list/search/filter navigation preservation; full keyboard/device coverage. | Inventory sidebar against section 9 without entering modules. Check production copy. Verify state restoration beyond known failures and a defined keyboard/responsive matrix. Highlight, focus and one narrow viewport do not close these checks. |
| YELLOW  DEVELOPER CONFIRMATION
MSG-053 Sections 6 14 | Absent Text/SMS quick action and channel eligibility. | Establish configured provider/channel, allowed role and consent/preferences. Portal requires permitted access; email requires valid address and provider; SMS requires mobile/provider/consent. Disable/hide unavailable channels with reason; no silent fallback unless explicitly configured. |
| YELLOW  DEVELOPER CONFIRMATION
Sections 6 10 22 | Permissions, tenant isolation, sensitive data, internal notes, secure attachments, exports and audit. | Provide role/channel/client-scope and cross-firm isolation tests; server enforcement for data/actions/search/counts; internal-note privacy evidence; secure upload/download and separate export controls. Use portal for confidential taxpayer/document content. No cross-tenant probing or live-send proof occurred. |
| YELLOW  DEVELOPER CONFIRMATION
Sections 4 10 21 22 | History, notification and delivery/error state correctness. | Prove sender/recipient/time/channel/provider outcome/attachment/related-record preservation and notification rules. Use controlled fixtures for loading, empty, draft, scheduled, queued, failed, partial, muted, archived, missing contact/consent, provider-disconnected, network and permission-denied states. Preserve state, link disconnected providers to Integrations and retry idempotently. No delivery outcome is passed. |
| YELLOW  DEVELOPER CONFIRMATION
Sections 20 23 24 | One shared dataset, canonical master-data reuse, models, integrations and complete acceptance. | Provide architecture and staged-build evidence for conversation/participant/message/attachment/draft/schedule/campaign/outcome/template/audit models; canonical modules; provider integration; audit/error/accessibility and controlled end-to-end QA. Audit send, schedule/cancel, campaigns, assignment, archive/restore, template/settings changes, exports and material attachment actions. |

| Source coverage sections 1 to 12 |

| Sec | Source topic | Coverage state | Current evidence and remaining scope |
| 1 | Main page sections | PARTIAL | Search name/clear/known word and panel observations pass narrowly. Email/phone, Settings and activity gaps are red. Business/lead search, context tag and unread fixture remain open. |
| 2 | Button and color rules | PARTIAL | Gold New Message and blue active tabs pass; Bulk/Templates styling needs correction. Settings is missing. Unread red badge/count requires unread data. |
| 3 | Tabs | PARTIAL | Four required tabs missing. Invoices/Documents shared layout passes only. Linked memberships need fixtures; Invoices payment scope is unverified. Documents is allowed. |
| 4 | New Message flow | PARTIAL | Modal, field presence, one selected client, combined-blank disabled Send and Escape pass. Recipient/channel/options gaps are red. Cancel untested; send/history/notify not passed. |
| 5 | Conversation panel | PARTIAL | Sender/time, chronology, scroll and two-thread synchronization pass. Channel/composer/state UI gaps are red. Action/attachment card fixtures and provider state support remain open. |
| 6 | Contact panel | PARTIAL | Listed info, note save/refresh, email prefill, handler launch and profile destination pass narrowly. Schedule prefill, tags/staff/activity and return gaps red. No inline Edit required; note privacy/SMS/master edit unproven. |
| 7 | Thread actions | BLOCKED | Menu missing is red. Profile/read/unread/assignment/tags/task/appointment/mute/archive behaviors are blocked, not independently failed. |
| 8 | Bulk and templates | PARTIAL | Bulk audience entry inaccessible and Templates scope wrong. Bulk downstream blocked; deep Communications/Templates user-deferred. Sensitive-data send behavior not tested. |
| 9 | Workspace sidebar | PARTIAL | Messages active highlight passes only. Full 24 labels/order is untested; section 9 remains the comparison baseline. |
| 10 | System rules | PARTIAL | Narrow layout and UI observations only. Server permissions/tenant/search/history need evidence. Loading/error fixtures and full device coverage unestablished. |
| 11 | Approved frame package | PENDING | All three frame references read; images absent, so visual fidelity blocked. Decorative cursive-copy absence remains untested, not blocked. |
| 12 | Frame 1 workspace | PARTIAL | Reuse reconciled inbox/panel findings. Two-thread synchronization passes; menu/settings/tabs/activity and contextual-return gaps remain. Broader state preservation/canonical routes unverified. |

| Source coverage sections 13 to 24 |

| Sec | Source topic | Coverage state | Current evidence and remaining scope |
| 13 | Frame 2 compose | PARTIAL | Single-client selection passes narrowly. Leads/multi/count/Clear All, channel/template/attachment/related/staff/timeline/merge/review/schedule omissions red. Read-receipt applicability unknown; full flow blocked. |
| 14 | Eligibility and scheduling | BLOCKED | Known missing controls prevent draft/schedule/template/attachment/related/merge tests. Channel eligibility, timezone, provider and failed-only retry need controlled evidence. |
| 15 | Frame 3 bulk builder | BLOCKED | Messages entry does not expose Audience/Message/Review/Send. General Communications is not substitute evidence. |
| 16 | Audience filters | BLOCKED | No accessible audience form. Canonical filter sources require implemented flow and developer evidence; no individual filter falsely failed. |
| 17 | Bulk safeguards | BLOCKED | Counts/reasons, selection, dedupe, suppression, preview, thresholds, throttling, idempotency, retry and export need controlled flow and backend evidence. |
| 18 | Message templates | USER DEFERRED | Only entry scope defect and list-control presence established. No Create Template form, schema, preview/use/manage behavior inferred. Separate deep review deferred. |
| 19 | Messages settings | BLOCKED | Missing Settings entry is red; individual settings/configuration remain untested behind that prerequisite. |
| 20 | Messages and Communications | PARTIAL | Route/scope distinction observed. Canonical contacts/templates/no-duplication and architecture need developer confirmation. Broader Communications review deferred. |
| 21 | Delivery and error states | PARTIAL | Combined-blank validation passes; delivery-state UI absent. Remaining states need controls/fixtures/configuration. No external delivery, provider status or retry proof. |
| 22 | Security and audit | DEVELOPER CONFIRMATION | Role/channel scope, tenant isolation, secure attachments, exports, sensitive-data safeguards and audit records require server-side tests/logs. No security pass from UI observations. |
| 23 | Acceptance checklist | PARTIAL | Focus/Escape/tested narrow layout pass only. Full feature, permission-aware synchronization, canonical routing, delivery/history/state, accessibility and end-to-end acceptance remain open. |
| 24 | Recommended build sequence | DEVELOPER CONFIRMATION | Sequence read, not tested implementation. Confirm models, canonical records, staged screens, providers, cross-module integrations and final audit/error/accessibility/delivery QA. |

