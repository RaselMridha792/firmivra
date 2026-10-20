Firmivra Communications Settings Correction Guide
Developer corrections and required flows • October 18 2026
Repair the existing Settings → Communications page. Latest owner testing supersedes the earlier broad failure report. Saving changes, Sender Identity, Header, Footer, Disclaimer and Preview all work and are APPROVED. Preserve these working features. The only currently reported defect is Open Communications in the Text Messages card returning “Page not found”. This is owner-tested status, not an independent code review.
This page sets firm email defaults. The main Communications module handles sending and tracking. Keep alert preferences under Settings → Notifications. Do not change the existing SMS content policy without a separate approved requirement.
# Approved functionality and outstanding correction
Control or area | Required behavior
APPROVED | Saving changes and Sender Identity information persist correctly.
APPROVED | Header, Footer and Disclaimer work.
APPROVED | Preview displays the message with the entered settings.
FIX REQUIRED | Text Messages → Open Communications returns Page not found. Repair the destination route.
# Existing page and correction locations
The only reported fix is the Open Communications link in the lower-right Text Messages card. Preserve the approved Sender Identity, Email Content, Preview and saving behavior.
Status convention: approved sections below document behavior to preserve and regression checks. They are not a request to rebuild working controls. Additional validation and permission checks are requirements to verify, not newly observed failures.
# Sender Identity approved behavior to preserve
Control or area | Required behavior
From Name | Allow an authorized user to edit the display name. Preview reflects the current draft value. Save persists it for this firm and future messages; reload shows the saved value.
Reply-To Email | Allow editing; trim surrounding whitespace and validate email format. Show inline errors on invalid input. Preview displays the entered address; when blank, show the verified sending address as the fallback.
Verified sender | Display the actual verified sending address and verification state read-only. Do not substitute the Reply-To address for the sending identity. Offer authorized provider management only through the existing integration flow.
Placeholder correction | Determine whether office@yourfirm.com is a placeholder or a stored value. A placeholder must not be saved or used as a real address. Show actual saved values or clearly labeled examples.
# Email Content approved behavior to preserve
Control or area | Required behavior
Header | Edit the firm email header. Render it above a sample body in Preview. An empty optional header adds no empty block.
Footer | Edit the firm footer. Render below the sample message; do not duplicate a footer already added by the shared email renderer.
Disclaimer | Edit and preview the firm disclaimer beneath the footer. Preserve mandatory system content separately; user changes cannot remove required system elements.
Rendering | Use the same safe shared rendering rules for preview and sent email. Preserve supported line breaks and formatting. Sanitize content; do not execute scripts or arbitrary HTML.
Message integration | Saved defaults apply to future eligible firm emails from the main Communications module and automated flows using the shared renderer. Do not rewrite previously sent messages. Document any template-specific exceptions.
# Preview approved behavior to preserve
Control or area | Required behavior
Preview action | Preserve the owner-approved preview interaction. If it is an inline panel, refresh it from current draft values; if opened by a button, open a preview dialog with Close.
Rendered content | Show actual From Name, verified From address, effective Reply-To, header, clearly labeled sample message body, footer and disclaimer in their final order.
Draft behavior | Reflect unsaved edits. Preview does not save settings, send a message or create a client communication record.
Validation and errors | Show invalid fields clearly; never invent an address or silently use placeholder text. Rendering failure preserves the draft and offers retry.
Close | Close returns to the same edited form without losing the draft. Use sample recipient data only; no real client data is needed.
# Text Messages link correction
Control or area | Required behavior
Open Communications | FIX REQUIRED: replace the broken link that returns Page not found with the registered canonical main Communications route for the current firm. Verify direct navigation, page refresh and browser back. Open the texting area if it exists; otherwise open the module landing page.
Unsaved changes | Before leaving, offer Save and Leave, Discard and Leave, or Stay. If saving fails, remain on this page with the draft intact.
Permissions | Enforce destination permissions. If restricted, show a clear explanation rather than a broken link or unauthorized data.
SMS policy | Preserve the policy shown in the screenshot: notices say a message is waiting and do not carry document links, codes or client data. Respect client channel choices. This correction does not authorize sending test texts.
# Save Cancel and connected page behavior
Control or area | Required behavior
Save Changes | Validate all editable fields, submit one firm-scoped update, prevent duplicate submissions, and confirm only after server success. On failure keep the draft and show retry guidance.
Cancel | Restore the last saved settings after confirming discard when needed. Cancel must not clear saved values.
Navigation | Highlight Settings in the LVP main sidebar and Communications in the Settings submenu. Preserve the firm, permissions and browser back behavior.
Authorization and audit | Only users with communication-settings permission can edit. Enforce server-side firm isolation. Audit actor, time, firm, changed fields and result without credentials or unrelated client content.
Loading and accessibility | Show loading, unavailable and retry states. Label fields and actions, preserve keyboard focus and stack cards sensibly on small screens.
# Acceptance tests
Control or area | Required behavior
01 | Confirm approved features remain working; reproduce Open Communications returning Page not found.
02 | From Name saves, reloads and appears in draft preview.
03 | Valid Reply-To displays exactly; invalid input is rejected.
04 | Blank Reply-To falls back to the actual verified sender; placeholder text is never used.
05 | Header, footer and disclaimer render once in the correct order.
06 | Preview reflects unsaved changes without saving or sending.
07 | Preview close and rendering failure preserve draft edits.
08 | Save success persists; failure retains draft; Cancel restores saved values.
09 | Open Communications reaches the correct module and firm.
10 | Unsaved navigation choices and permission-denied states work.
11 | Future eligible emails use saved settings; historic emails remain unchanged.
12 | Cross-firm access, unauthorized edits and unsafe markup are blocked; audit records are complete.