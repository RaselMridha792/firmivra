Confirmed Checks

# Confirm These Checkout

Firmivra Settings supplemental developer checklistPrepared for the developer on behalf of Octavia HolderOctober 19 2026
Confirm these checks alongside the instructions for each applicable Settings section. This checklist supplements the original Settings guide and all later approved corrections and flows. Keep those edits intact; do not replace them with older requirements.
Status clarification: the title names this checklist. The items below are pending developer confirmation, not confirmed missing features or completed tests. Settings is complete for the first review; correction implementation and functionality verification remain pending.
Platform Administration is excluded from the gap list. Octavia confirmed that Company Applications and Company Management are built separately. Their review and functionality testing remain pending.

# Developer response instructions

For each row, return: Built or Partially Built or Not Built; exact page or destination; test result; build and test date; supporting screenshot or test evidence; and any remaining work. An open page or success message alone does not establish that the full function works.

# Checks 1 through 4

| ID | Applicable section | Instructions to confirm | Evidence required |
|---|---|---|---|
| 1 | Settings Overview | Verify live KPIs, connected applications, quick settings and recent administrative activity. Each item must load authorized company data and open the correct page. | Compare displayed data with known records. Open each destination. Test loading, genuine empty results and failure with retry. |
| 2 | Users and Roles and Staff Management | Verify remaining employee row actions: View Profile, Edit User, Manage Access, Reset MFA, Sign Out All Sessions and View Activity. Preserve the newer role, invitation and permission rules. | Open each action for a test employee. Confirm saved changes persist. MFA reset requires re-enrollment; session sign-out stops existing access; View Activity filters to the selected employee. |
| 3 | Ownership transfer | Verify a controlled Change Owner process and final-owner/admin protection. Identify who initiates and accepts a transfer, what permissions change, and where the action lives. It may be in the separate administration area. | Use test accounts to complete and cancel a transfer. Block removal of the final qualified owner/admin without a controlled replacement. Record the action in the audit log. |
| 4 | Branding and login customization | Verify favicon/app mark, login background, login message, preview, validation, saving and reset. These are additional checks beyond company logo and colors. | Upload valid and invalid assets. Preview before publishing. Confirm save and reset affect only the current company; failed replacement preserves the prior asset. |

Developer response: provide implementation status, exact destination, test result, build/date and evidence for each ID above. Mark untested behavior as Pending verification; identify missing or incomplete work explicitly.

# Checks 5 through 8

| ID | Applicable section | Instructions to confirm | Evidence required |
|---|---|---|---|
| 5 | Branding across supported surfaces | Verify email branding, client portal branding, document letterhead and supported signature blocks. Preserve previously sent emails and generated documents. | Generate a new sample on each supported surface after a branding update. Confirm company-specific branding and verify historical artifacts remain unchanged. |
| 6 | Security and Access | Verify trusted-device viewing/revocation, session timeout, failed-login protection, security alerts and revocation of existing sessions. Check backend enforcement, not only saved settings. | Use test sessions to demonstrate timeout and revocation. Verify failed-login controls and required alerts. Confirm deactivation stops existing access according to the approved security rules. |
| 7 | Data and Backups | Verify restore authorization, confirmation, recovery safeguards and recovery outcome. Retention and cancellation decisions remain intact and do not replace backup restore testing. | Restore a known backup in an isolated test environment. Compare recovered records and files, demonstrate failure recovery and provide audit evidence. Do not test by overwriting live firm data. |
| 8 | All editable Settings sections | Verify unsaved-change prompts, simultaneous-edit conflicts, permission errors and failed-save recovery. Apply consistently across forms and dialogs. | Test Save, Discard and Keep Editing; edit from two sessions; interrupt a save. Do not silently overwrite newer changes or lose entered values after failure. |

Developer response: provide implementation status, exact destination, test result, build/date and evidence for each ID above. Mark untested behavior as Pending verification; identify missing or incomplete work explicitly.

# Checks 9 through 11

| ID | Applicable section | Instructions to confirm | Evidence required |
|---|---|---|---|
| 9 | All Settings sections and Audit Log | Verify server-side company isolation and complete accurate audit records for material changes. Hiding a control is insufficient authorization. | Test direct links and requests with authorized development accounts. Block cross-company data and unauthorized actions. Verify actor, company, target, timestamp, outcome and safe change details in audit records. |
| 10 | Company Profile and connected Settings pages | Map the original six tabs to current destinations: Company Profile; Branding and White Label; Email and Communications; Client Portal Branding; Documents and Legal; Preferences. Separate pages are acceptable if every function has a clear destination. | Return a tab-to-page mapping and list implemented controls. Open each destination and identify any original requirement without a current home. Preserve all newer approved layouts and flows. |
| 11 | Company Profile Preferences Branding and related pages | Verify shared time zone, currency, language and branding settings use consistent company data. Preserve approved individual overrides and audience-specific language rules. | Change a shared value and inspect every applicable screen after refresh. Verify no conflicting copies. Employee language overrides apply only when allowed; clients start in English and permitted personal choices persist. Formatting changes must not rewrite historical financial values. |

Developer response: provide implementation status, exact destination, test result, build/date and evidence for each ID above. Mark untested behavior as Pending verification; identify missing or incomplete work explicitly.

# Preserve approved changes

Later approved instructions take priority over conflicting original wording. Retain the revised roles and individual permission overrides, activation-code workflow, billing controls, document-sharing and verification rules, upload limits, retention decisions and language toggles. This checklist adds verification tasks only.
