Firmivra Notifications Settings Developer Feedback
Employee notifications • Approval with delivery conditions • October 18 2026
APPROVED SUBJECT TO VERIFICATION: The owner approves the Notifications tab so far. Final approval is contingent on BOTH email and text notifications working according to the enabled settings and applicable categories. Saving preferences alone is not proof of delivery. SMS remains untested because no mobile number is attached.
Scope: employee notification settings. Leave client portal requirements to the separate Client Portal review. The developer must confirm whether this page currently affects internal users only or also influences the portal; do not assume that relationship is verified.
# Reviewed Notifications screen
# Approval and required clarification
Control or area | Required behavior
APPROVED | Reviewed Notifications layout and behavior, subject to the delivery conditions in this guide.
REQUIRED UPDATE | Employee operational email notifications must stay ON and cannot be disabled.
PENDING TEST | Email and SMS delivery must be verified against the enabled category settings. SMS testing requires an attached mobile number.
DEVELOPER CONFIRM | Confirm the implemented audience, notification event wiring and whether portal preferences are separate. No client portal changes are specified here.
# Employee settings and required flows
Control or area | Required behavior
In-app | Preserve Always for relevant authorized events. Employees only receive alerts for records and actions they are allowed to access.
Email permanently ON | Keep employee email enabled for displayed operational categories. Replace editable email checkboxes with checked locked controls or Always On labels. Enforce server-side and migrate existing OFF operational-email preferences to ON. This does not change marketing subscriptions.
Text messages | Allow category choices only after the required mobile-number setup, verification and opt-in. Respect SMS opt-out. Show a clear reason while unavailable and a working profile link.
Save Changes | Save allowed SMS choices for the signed-in user and firm. Keep email ON. Show success after server confirmation; preserve drafts on failure.
Cancel | Restore saved editable preferences without changing other users or turning off required email.
Notification navigation | Clicking an in-app alert opens the correct authorized record. Main sidebar Settings and submenu Notifications remain active on this page.
Event categories | Confirm triggers and recipients for Account and Security, Documents, Intake Forms, Services, Messages and Notes, Appointments, and Invoices and Payments. Internal notes remain permission restricted.
SMS content | Follow the existing generic notice policy without client data, document links or codes. Keep any separate authentication-code flow outside this specification.
Delivery integrity | Track channel outcomes, deduplicate events, retry safely and isolate recipients by firm and user. Do not treat queued or failed messages as delivered.
# Developer confirmation requested
Confirm in the developer response: the page’s actual audience and route; how employee alerts connect to source modules; whether the portal has independent preferences; and where email/SMS delivery outcomes can be verified. The portal itself will be reviewed separately. This request is documented here, not sent externally.
# Acceptance and final approval conditions
Control or area | Required behavior
01 | Employee email remains ON after reload and cannot be disabled through UI or API.
02 | Adding the required test mobile number enables eligible SMS choices; selections save and reload.
03 | Trigger authorized test events and confirm email reaches the correct employee for enabled operational categories.
04 | Confirm SMS reaches the intended test recipient for selected categories and is not sent for deselected categories or opted-out numbers.
05 | Verify Save, Cancel, missing-number guidance and profile navigation.
06 | Verify permissions, firm isolation, duplicate prevention and handling of delivery failures.
07 | Developer confirms audience, event mappings and portal separation without adding portal work to this guide.
FINAL | Approval remains conditional until BOTH email and SMS pass delivery tests according to enabled settings. Record results and retest any failures before final signoff.