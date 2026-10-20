LVP Pro | Company Profile
Developer implementation & review guide  •  18 October 2026
Scope: Company Profile tab only. Preserve the approved screenshot design. The numbered overlays identify functional areas; they are NOT UI elements to implement.
Figure 1. Approved Company Profile screenshot with numbered implementation callouts.
# A. Navigation already working — keep unchanged
Item | Destination / expected navigation | Link status | Destination page review
Branding & White Label | Settings → Branding | ✓ Correct | Not yet reviewed
Email & Communications | Settings → Communications | ✓ Correct | Not yet reviewed
Client Portal Branding | Client Portal | ✓ Correct | Not yet reviewed
Documents & Legal | Terms of Service / Intake Agreements | ✓ Correct | Not yet reviewed
Preferences | Settings → Preferences | ✓ Correct | Not yet reviewed
“Correct” refers only to navigation, as reported during the review; functionality/content of each destination page remains pending review.
# B. Numbered sections — updates and click behavior
# / area | Required behavior / destination | Action
1. Company Profile header & horizontal links | Keep the approved layout. Keep clickable tabs directly below the Company Profile heading; selected Company Profile tab highlighted. Other five links route as listed in section A. | KEEP + VERIFY
2. Company Information | Legal company name and EIN are locked. Request Change opens a modal with current values, proposed values, reason/supporting documentation as needed, Submit and Cancel. Submit sends request to the software provider / firm administration for review; no immediate record change. Show confirmation and status. | ADD WORKFLOW
3. Professional Licensing Information | Licensing fields remain read-only. Request Change opens the same request workflow with licensing-specific fields. Route to software provider / firm administration for approval/update; do not directly overwrite. | ADD WORKFLOW
4. Company Contact Information | Edit opens a modal with editable contact name, title, business phone, support/billing email, website, and business address. Save validates and updates displayed contact details; Cancel/close discards. Authorized company admins only. | ADD MODAL
5. Company Links & Integrations | Display copyable generated URLs for Client Portal, Client Intake Form, Appointments and Services. Copy places the URL on clipboard and shows “Copied”. Newly created/activated intake forms appear as additional appropriate links; do not invent links for inactive features. | DYNAMIC LINKS
6. Company Logo & Brand Assets | Display current logo, favicon and email signature status. Go to Branding opens Settings → Branding to update assets. No separate editor here. | LINK TO BRANDING
7. Brand Color & Theme Options | Display current brand colors and theme. Customize Theme opens Settings → Branding (not an inline edit). Quick Actions Customize Theme follows same route. | LINK TO BRANDING
8. Login Page Customization | Display preview and status. Customize Login Page opens the relevant login-page customization within Branding. Live Preview opens customer-facing login page preview without saving changes. | BRANDING + PREVIEW
9. Quick Actions | Edit Contact Information opens same modal as #4. Manage Branding and Customize Theme open Settings → Branding. Preview Login Page opens same customer-facing preview as #8. | REUSE ACTIONS
# C. Modal and routing acceptance criteria
Workflow | Expected outcome / test
Request Change (company / licensing) | Opens modal → required inputs validated → request submitted to software provider/firm admin queue → user receives confirmation; locked values unchanged until approved update.
Edit Contact Information | Admin clicks Edit → modal opens prefilled → Save persists valid edits and updates summary → Cancel leaves original data intact.
Branding routes | Logo, Manage Branding, Customize Theme and Customize Login Page navigate to the appropriate Branding section; no duplicate edit UI on Company Profile.
Customer login preview | Live Preview and Preview Login Page show customer view, ideally in a separate tab or preview overlay; no live configuration changed.
Copyable links | Each Copy button copies the corresponding exact URL, confirms success, and generated intake links refresh when forms are added/activated.
Visual preservation | Keep sidebar, spacing, cards, colors, existing content and approved horizontal tab placement. Do not redesign unrelated Settings pages.
# D. Developer handoff / QA
Status key: GREEN = confirmed navigation; BLUE = implement/update; AMBER = destination page or functional QA pending. Do not mark a destination page fully approved merely because its link works.
Implementation note: routing labels above describe the requested destination. Confirm exact internal routes and provider-side change-request recipient with the project team; the screenshot itself does not establish backend endpoints.
E. Detailed implementation specification
Supplement to Sections A–D. Preserve the approved Company Profile layout and five existing working navigation links. Requirements below define behavior and acceptance criteria; exact application route names and integration endpoints must be confirmed against the existing codebase.
# E1. Access and permissions
Role / context | Allowed | Restriction / expected behavior
Firm administrator / authorized owner | Edit contact information, use branding links, copy links, preview login, submit change requests | Use existing RBAC; do not grant rights by UI visibility alone.
Authorized staff | View profile and copy published links | Editing and branding rights only when explicitly granted by firm permissions.
Client / portal user | Access only client-facing published URLs | No access to internal company profile, settings, or change-request actions.
Software provider / support team | Receive and process restricted information-change requests | Changes to restricted identity fields require authorized back-office review; never auto-apply on submission.
# E2. Controls, destinations, and click outcomes
Control | On click | After action
Branding & White Label | Navigate to existing Settings → Branding | Preserve current working route; destination page NOT YET REVIEWED.
Email & Communications | Navigate to existing Settings → Communications | Preserve current working route; destination page NOT YET REVIEWED.
Client Portal Branding | Navigate to existing Client Portal destination | Preserve current working route; destination page NOT YET REVIEWED.
Documents & Legal | Navigate to existing Terms of Service / Intake Agreements destination | Preserve current working route; destination page NOT YET REVIEWED.
Preferences | Navigate to existing Settings → Preferences | Preserve current working route; destination page NOT YET REVIEWED.
Company logo / Change logo | Navigate to Settings → Branding | Use same branding route; do not create a second logo editor.
Theme / Customize Theme | Navigate to Settings → Branding | Branding controls belong to Branding page.
Company Contact Information / Edit | Open contact-edit modal, prefilled | Save updates authorized fields; Cancel/Close discard changes.
Quick Action: Edit Contact Information | Open same contact-edit modal | Reuse identical component, validation and save behavior.
Quick Action: Customize Theme | Navigate to Settings → Branding | Same route as Theme.
Quick Action: Preview Login Page | Open read-only client-facing login preview | Preview current saved branding and login design; do not edit live content in preview.
Company Links: copy icon | Copy corresponding URL to clipboard | Show copied confirmation; error feedback on failure.
Company Links: intake forms | Display active published intake-form URLs | Newly published forms appear automatically; revoked/unpublished forms disappear or are clearly inactive.
Request Change: company/professional information | Open request modal | Send request to software provider/firm support workflow; do not update restricted fields immediately.
# E3. Contact-edit modal specification
Element | Implementation requirement | Validation / feedback
Open state | Display current saved company contact details as prefilled values | Trap keyboard focus; Escape and close icon behave consistently.
Editable fields | Use existing contact data model (e.g., phone, email, website, mailing/contact address where available) | Email format; phone length/format; URL protocol; required fields follow existing schema.
Save | Disable double submission; send authenticated update; refresh profile summary after success | Success toast; preserve edits on network error and show retry option.
Cancel / Close | Discard unsaved edits; prompt before discard if changes exist | No server write when cancelled.
Security | Validate permissions and inputs on server; audit change actor and time | Do not allow cross-firm record edits.
# E4. Restricted information change-request modal
Element | Implementation requirement | Validation / feedback
Scope | Company legal identity or professional/licensing information marked request-only | Keep current values read-only on Company Profile until approved.
Fields | Current value, proposed value, reason, optional supporting document if supported, requester identity | Require proposed value and reason; check allowed file types/size if uploads are enabled.
Submit | Create tracked request and deliver to configured software-provider/firm-support queue | Display reference number/status; notify requester; no direct change to approved profile data.
Processing | Authorized provider reviews, approves/rejects, and records decision | Approval updates canonical data only after verification; requester notified of outcome.
Failure / duplicate | Retain entered values on failure; prevent accidental duplicate submissions | Show actionable error and retry path; audit event.
# E5. Company Links generation and preview
Area | Implementation requirement | Expected result
Source of truth | Load URLs from firm-owned published forms/portal configuration | No hard-coded intake URLs; firm data isolation.
Form lifecycle | Update list on publish, rename, unpublish, or revoke | Only current shareable links are offered as active.
Copy action | Use browser clipboard API with fallback/error handling | Correct complete URL copied; visible success confirmation.
Preview Login Page | Read-only preview using saved client-login branding/configuration | Matches customer view at common desktop and mobile widths; no exposure of admin controls.
# E6. Engineering and nonfunctional requirements
Category | Implementation / acceptance standard
Navigation | Use existing router and paths; browser Back/Forward and direct reload work.
Persistence | All successful authorized edits survive refresh, logout/login, and new sessions.
Accessibility | Keyboard navigation, labeled controls, visible focus, accessible modal titles and error messages.
Responsive layout | Preserve approved desktop design and ensure usable mobile/tablet layout without clipping.
Loading and errors | Show loading/disabled states, handle unauthorized, timeout, and API failure with meaningful feedback.
Audit / privacy | Record restricted requests and edits; never expose firm data to other tenants.
Regression protection | Do not modify five confirmed navigation routes or change approved screenshot layout outside specified additions.
F. Developer functional testing and sign-off
Run tests with authorized firm administrator, restricted staff, and client/unauthorized roles. Record Pass/Fail, tester, date, evidence, and issue ID for every case. “Link correct” does not mean the destination page has been reviewed.
# F1. Test execution matrix
ID | Feature / action | Test steps | Expected result
T01 | Branding & White Label | Click from Company Profile | Existing Branding page opens; status: navigation confirmed, destination review pending
T02 | Email & Communications | Click from Company Profile | Existing Communications page opens; destination review pending
T03 | Client Portal Branding | Click from Company Profile | Existing Client Portal destination opens; destination review pending
T04 | Documents & Legal | Click from Company Profile | Existing legal/intake destination opens; destination review pending
T05 | Preferences | Click from Company Profile | Existing Preferences page opens; destination review pending
T06 | Header horizontal tabs | Click each approved tab; use Back and reload | Correct destination and active state; no broken routes
T07 | Company logo | Click logo/edit branding control | Branding page opens; no duplicate modal
T08 | Customize Theme (section + Quick Action) | Click both controls | Both reach same Branding page
T09 | Contact editor open | Click contact information Edit and Quick Action | Same prefilled modal opens both ways
T10 | Contact editor save | Edit valid fields and Save; refresh | New values persist and appear in summary
T11 | Contact editor cancel | Modify then Cancel/Close | No data change; unsaved-change warning as applicable
T12 | Contact validation | Submit invalid email/phone/URL | Inline errors; no invalid save
T13 | Contact API failure | Simulate failed update | Error and retry; typed changes retained
T14 | Restricted change request | Submit valid company/professional change | Request ID and confirmation; support queue receives; original field unchanged
T15 | Change request rejection/error | Submit incomplete or simulate failure | Validation/error displayed; no silent update or duplicate
T16 | Change request approval | Process request in authorized provider workflow | Approved change propagates; audit trail and requester notice
T17 | Intake link creation | Publish new intake form | Correct firm URL appears automatically
T18 | Intake link removal | Unpublish form | Link removed or clearly inactive
T19 | Copy company link | Click copy then paste into browser/text field | Exact current URL copied; success feedback
T20 | Clipboard failure | Block clipboard permission | Clear failure feedback / supported fallback
T21 | Preview login | Click Preview Login Page | Read-only customer login preview reflects saved branding
T22 | Permissions | Try restricted action as unauthorized staff/client | UI hidden/disabled as appropriate and server denies request
T23 | Tenant isolation | Attempt to access another firm’s data/URL | No unauthorized data or edits
T24 | Responsive and keyboard | Test mobile, desktop, Tab, Escape, focus | No overlap; keyboard and modal focus function correctly
T25 | Persistence and regression | Refresh, relogin, revisit all five links | Saved changes remain; existing working links remain intact
# F2. Sign-off record
Item | Result / notes
Screenshot parity | Approved layout preserved; numbered overlays are documentation only: ______
Navigation regression | T01–T06 completed: ______
Modal / request workflow | T09–T16 completed: ______
Links / preview | T17–T21 completed: ______
Security / accessibility / persistence | T22–T25 completed: ______
Open issues / defect IDs | ______
Developer / date | ______
Reviewer / date | ______
Destination pages | All five remain NOT YET REVIEWED until separately approved.