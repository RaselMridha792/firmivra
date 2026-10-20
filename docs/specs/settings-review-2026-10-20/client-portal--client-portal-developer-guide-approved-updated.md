LVP PRO | CLIENT PORTAL SETTINGS
DEVELOPER IMPLEMENTATION GUIDE  •  Corrections & Updates to Existing Portal  •  18 October 2026
Scope: Modify the existing client portal settings and related portal behavior. Do not rebuild the portal. Preserve current data, client accounts, and existing working integrations. Screenshots are design references; implement the behaviors specified below and flag conflicts before development.
# 1. Portal Settings Dashboard
Figure 1.1 — Approved Portal Settings Dashboard reference screenshot
Requirement | Developer implementation / acceptance criteria
Settings-only scope | Keep the existing portal settings dashboard as the central administration panel. Settings configure available client experiences; do not place operational content creation here.
Navigation | Retain links to Registration & Access, Announcements, Contact Information and Features. Navigation should open the corresponding settings panel without losing unsaved work silently.
Client preview | View Client Portal opens a client-perspective preview using current settings and the selected/test client context; distinguish preview from the live portal.
Save and permissions | Company-authorized administrators can edit settings; persist changes and show success/error states. Avoid allowing clients to change firm-level configuration.
# 1.2 Testing and acceptance
1.2.1  Each settings tab loads from the dashboard.
1.2.2  Saved settings persist after refresh; unauthorized users cannot edit.
1.2.3  Client preview reflects enabled settings without modifying real client data.
# 2. Registration & Access
Figure 2.1 — Approved Registration & Access reference screenshot
Requirement | Developer implementation / acceptance criteria
Existing workflow | Preserve the existing registration and access workflow shown in the approved reference; changes must not break existing logins, invitations or accounts.
Firm vs client control | Only company-authorized users configure registration and access policies; clients complete permitted registration and account actions.
Location assignment | During registration, the client chooses from active office locations with full addresses. Save that selection as the assigned office; permit administrator reassignment.
Data and security | Validate identity and access rights on the server; enforce secure session, account recovery and role checks. Never expose one client’s documents to another.
# 2.2 Testing and acceptance
2.2.1  Existing client can sign in and access their own records.
2.2.2  New client registration follows configured access rules.
2.2.3  Office assignment and authorized override work without exposing other client data.
# 3. Announcements
Figure 3.1 — Approved Announcements reference screenshot
Requirement | Developer implementation / acceptance criteria
Settings, not creation | Remove Create Announcement workflow from this tab. Provide a Go to Communications / Create Announcement navigation link; actual creation occurs under main-menu Communications.
Enable announcements | Firm controls whether public/general announcements are enabled and visible in client portal. Do not conflate this with individual delivery preferences.
Personal service/account notifications | Email delivery is mandatory and locked on. SMS may be optional per client, subject to firm policy and valid SMS consent.
General/public announcements | When firm enables announcements, clients can select email and SMS independently if company policy permits. In-portal visibility remains separate from external notification choices.
Company policy controls | Allow firm to decide whether client may change each optional channel or whether it is required/locked. Do not offer a client switch that can override mandatory firm policy.
Preview | View Client Portal reflects the resulting client notification choices and mandatory/locked controls.
# 3.2 Testing and acceptance
3.2.1  No announcement editor appears in Portal Settings.
3.2.2  Communications link opens creation flow.
3.2.3  Mandatory email cannot be disabled; optional channels save correctly.
3.2.4  Turning off external notifications does not inadvertently erase stored announcements.
# 4. Contact Information
Figure 4.1 — Approved Contact Information reference screenshot
Requirement | Developer implementation / acceptance criteria
Office display | Firm separately enables corporate office information and client-assigned local office information. Show only selected office contact details.
Local-office matching | Local office is the office the client selected during registration; authorized staff can override it. No automatic city/state matching.
Contact methods | Separate company toggles for phone/call, SMS/text, email, secure in-portal messaging, and appointment link if supported. Firm decides which methods clients may use.
Source of truth | Use company/office profile contact records; avoid duplicate free-form contact records in portal settings unless necessary.
Preview | Show corporate and local office as enabled, with only allowed contact actions. Respect SMS consent and do not confuse a call button with an SMS button.
# 4.2 Testing and acceptance
4.2.1  Each office display switch works independently.
4.2.2  Client sees the contact details for the office selected at registration, including after authorized reassignment.
4.2.3  SMS, phone, email, secure message toggles function separately.
4.2.4  Preview matches live portal and disabled actions cannot be accessed by URL.
# 5. Features
Figure 5.1 — Approved Features reference screenshot
Requirement | Developer implementation / acceptance criteria
Built-in modules | Provide firm-controlled enable/disable, rename and reorder for: Intake Forms; Business Documents & Resources; Upload Documents; Tax Returns; Receipts & Invoices; Notes & Messages.
Preserve existing functionality | Intake Forms: complete/submit intake. Business Documents & Resources: access company-provided resources. Upload Documents: submit files. Tax Returns: view prior returns. Receipts & Invoices: view applicable financial records. Notes & Messages: permitted communications.
Custom tabs | Allow Add Custom Tab with display name and exactly one existing supported function/module template. Example: Payroll Documents uses document upload. No custom code, arbitrary new capability or untracked data type.
Visibility | Firm can set which clients or client groups see custom tabs; enforce authorization on backend as well as navigation.
Safe disable | Hiding/disabling/renaming/reordering tabs never deletes documents, records, intake responses, messages or client history. Show explicit warning before disabling a tab.
Preview | Preview displays configured tab names, order and visibility for chosen client; no duplicate controls from Registration, Announcements or Contact Settings.
# 5.2 Testing and acceptance
5.2.1  All six default modules toggle, rename and reorder.
5.2.2  Custom tab can select one supported function and obey visibility rules.
5.2.3  Disabled modules hide without deleting data; re-enable restores access.
5.2.4  Direct URL access is blocked where permissions deny access.
# 6. Cross-Module Developer Checklist
Requirement | Developer implementation / acceptance criteria
6.1 No rebuild | Make changes incrementally to the existing LVP Pro application and existing client portal UI.
6.2 Authorization | Firm settings are admin-only; client-level preferences remain constrained by company policy.
6.3 Data retention | Never delete data when a tab is hidden, renamed or disabled.
6.4 Communication channels | Distinguish in-portal messages, email, SMS, and phone calls. Verify opt-in/consent for SMS.
6.5 Preview accuracy | Use realistic client context and ensure preview is read-only.
6.6 Responsive QA | Verify desktop and mobile layouts, labels, disabled states, and navigation.
6.7 Sign-off | Present working build and test results for each numbered section before marking complete.
Implementation note: Where screenshots and written acceptance criteria differ, confirm intended behavior with the product owner rather than silently replacing existing functionality.
# 7. Technical Implementation Requirements & Developer Acceptance Checklist
This section supplements Sections 1–6. It specifies expected behavior and measurable sign-off tests for corrections to the existing system, not a rebuild.
# 7.1 Save, Cancel & unsaved changes
Each editable settings page provides Save and Cancel/Discard. Save validates inputs, persists server-side atomically where possible, displays a success confirmation, and updates subsequent client views. Cancel restores last saved values without modifying the database. Warn before navigating away with unsaved changes. On failed save, preserve edits and display an actionable error.
Acceptance test: Test Save → refresh → same values; Cancel → old values; unsaved-navigation warning; failed-save behavior.
# 7.2 Permission matrix
Firm administrator controls module availability, mandatory notification policy, office visibility, communication channels, custom tabs, labels, order and client/group targeting. Client can only adjust explicitly permitted notification preferences and their permitted profile/registration fields. Apply permissions on server/API, not merely by hiding buttons.
Acceptance test: Test administrator and client roles separately; client cannot bypass disabled controls through direct links or API requests.
# 7.3 Custom tabs: behavior and storage
Custom tab setup requires unique label within its navigation scope, enabled state, display order, target clients/groups, and exactly one supported existing function. Store a stable module/template identifier separately from editable display label. Reuse that module’s established upload, validation, storage, permissions, audit and retention rules. A tab rename must not relocate files or break URLs. For upload-based custom tabs, associate files with the custom tab/category while preserving existing client ownership and access checks.
Acceptance test: Create a document-upload custom tab, upload a file, rename/reorder/hide/re-enable the tab, then verify file ownership, retrieval and audit history remain intact.
# 7.4 Office assignment rules
At registration, the client selects the office they intend to visit or work with from a list of active offices displaying name, city, state, and full street address. The selected office becomes the assigned office; show its approved contact details in the portal. An authorized company administrator may change the assignment later, with an audit record. Do not automatically assign offices based on client city/state.
Acceptance test: Test registration office list and full addresses, selection persistence, assigned office contact display, authorized reassignment, and corporate/local visibility combinations.
# 7.5 Notification routing and consent
Separate announcement visibility in portal from delivery via email and SMS. Mandatory personal/account email cannot be switched off by clients; optional SMS requires valid opt-in and respects opt-out. General announcement email/SMS preferences apply only if firm has enabled announcements and allows the channel. Maintain delivery records (event, recipient, channel, status, timestamp) and avoid duplicate sends when a user saves preferences. Creation remains in Communications.
Acceptance test: Test mandatory email locked; client channel changes; firm-required channel locked; SMS opt-out; disabled public announcements; one delivery per eligible channel/event.
# 7.6 Data protection & rollout
Before deployment, back up relevant settings and client data, apply reversible database migrations, and test on staging. Preserve existing accounts, historical tax returns, documents, invoices, intake submissions, notes, messages and audit trails. Disabling a feature only changes visibility/access and never deletes records. Document rollback steps and ensure existing integrations continue to function.
Acceptance test: Test old records before/after migration; disable/re-enable features; rollback in staging; regression checks on uploads, messages, appointments and login.
# 7.7 Sign-off evidence
Developer supplies per-section test results, screenshots of desktop and mobile portal preview, list of changed screens/components, any migration notes, unresolved questions, and confirmation that original data was preserved. Each numbered section must pass acceptance tests before final sign-off.
Acceptance test: Product owner reviews Sections 1–5 and the test evidence; failed cases remain open until fixed and retested.
# 8. Open Decisions to Confirm Before Deployment
Office selection is client-directed during registration; do not use automatic geographic matching.
Personal/account email is mandatory; SMS remains optional for all notifications and requires consent.
Personal portal hides business-only modules; Business portal can show both personal and business modules when enabled by firm. Custom tabs obey portal type and any firm-configured visibility.
Company Settings and Office Locations are the source of truth for contact details; client portal displays changes automatically. SMS delivery respects opt-in and opt-out.
# 9. Final Approved Business Rules — Supersedes Conflicting Earlier Text
# 9.1 Office selection
Client selects an active office during registration. Show office name and complete address. Selected office becomes assigned office and drives local-office contact details; company administrators can reassign it. No geographic auto-matching.
# 9.2 Notification channels
Personal/account/service email notifications are mandatory. SMS is optional for every notification type, with valid consent. General announcement email is optional, subject to company announcement settings; announcements are created in Communications.
# 9.3 Portal types and custom tab visibility
Client selects Personal or Business portal at registration. Personal hides business-only features and custom tabs. Business may show both personal and business features when company-enabled. Company may further target custom tabs to all eligible clients, eligible groups, or individual eligible clients. No hidden tab grants data access.
# 9.4 Contact data synchronization
Corporate and branch addresses, phone numbers and emails come from Company Settings / Office Locations, not duplicated portal-specific records. Changes propagate to the portal. Company controls which office details and communication methods are visible.
# 9.5 Acceptance test updates
Verify registration office selection and address; verify mandatory email and optional SMS; verify Personal vs Business tab visibility and backend access; verify updated company office details appear in client portal; verify existing data remains intact.