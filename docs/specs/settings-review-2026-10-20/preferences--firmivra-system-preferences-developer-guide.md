Firmivra System Preferences Developer Instructions
October 19, 2026 | Settings > Preferences
Preserve the saving behavior approved by the owner. Implement actual language translation and three language controls below Regional Settings. Verify each setting affects the correct users. Approval of saving does not prove downstream behavior has passed testing.
# Regional Settings
Item | Review status | Developer instruction
Time zone options | Approved initial list | Keep Eastern, Central, Mountain, Arizona, Pacific, Alaska, Hawaii, and Atlantic options as the starting list. Owner confirmed the dropdown opens.
Preference saving | Approved by owner test | Owner reports selected preferences save, and Spanish remains selected after refresh. Preserve saving and persistence; record regression-test results for every field.
Time zone effects | Pending testing | Verify schedules, reports, reminders, and appointments use the selected zone correctly. Use regional time-zone rules, including daylight saving where applicable, rather than a fixed offset.
Language selection | Correction | Spanish saves but visible interface text stays English in the owner’s test. Implement translated menus, buttons, labels, validation, and system messages in the defined language scope. A saved selection alone is insufficient.
Currency | Saving approved effects pending | Canadian dollars were selected during review. Confirm display and new supported transactions use the saved currency as intended. Preserve past invoices and payments in their original amounts and currencies; changing this preference must not perform implicit exchange conversion.
# Language Controls Below Regional Settings
Item | Review status | Developer instruction
Company language toggle | Correction | Add “Apply company-wide language.” When ON, the selected company language applies to the staff workspace, subject to permitted employee overrides. When OFF, use English as the staff baseline.
Employee choice toggle | Correction | Add “Allow employees to choose their language.” When ON, expose an employee language selector and apply their saved choice ahead of the company language for that employee only. When OFF, apply the staff baseline.
Client choice toggle | Correction | Add “Allow clients to choose their language.” When ON, allow selection at signup and later in client settings. When OFF, clients use English. The company language must not force the client portal into Spanish.
Who controls toggles | Implementation requirement | Authorized firm administrators manage these firm settings. Employees and clients change only their own preference when permitted. Enforce permissions server-side.
Translation scope | Approved requirement | A person’s effective language controls their interface and standard system notifications. Uploaded documents, tax returns, names, and firm-written content remain in their original language unless deliberately translated.
Independent settings | Approved requirement | Language controls must not change currency, time zone, date format, or number format. Do not change another person’s interface when an individual selects a language.
Persistence and selector | Implementation requirement | Keep an accessible selector displaying language names in their own language, including English and Español. Persist personal choices across refresh and sign-in; do not reset to English on every visit.
Default toggle states | Developer clarification | Owner has not specified initial ON/OFF values for these three toggles. Propose and document defaults for review. English is the initial language baseline.
# Language Resolution Rules
Item | Review status | Developer instruction
Staff without override | Required behavior | Company toggle ON: selected company language. Company toggle OFF: English.
Staff with allowed override | Required behavior | Employee choice ON and a saved personal preference: use that preference. If no preference exists, use the staff baseline.
Clients without override | Required behavior | Start in English regardless of company language. Client choice OFF or no saved preference: English.
Clients with allowed override | Required behavior | Client choice ON and a saved preference: use that language for their portal and standard system notifications. Preserve it for later visits.
Turning choice OFF | Required behavior | Ignore the corresponding personal override and apply the relevant baseline. Developer must document whether the saved preference is retained for possible future re-enabling.
Supported translations | Developer clarification | Confirm the exact supported languages and regional variants. English and Spanish must work as reviewed; do not offer unsupported translations as if functional.
# Formats
Item | Review status | Developer instruction
Date format options | Approved selection | Keep month/day/year, day/month/year, and year/month/day options. Owner reported successful saving.
Date rendering | Pending testing | Verify Live Example, workspace, portal, and intended reports use the chosen format and persist after refresh. Formatting must not change the underlying date.
Number format | Pending testing | Apply the selected thousands and decimal separators consistently. For example, 1,234.56 and 1.234,56 represent the same value. Preserve stored amounts and calculations.
Live Example | Pending testing | Show the selected date format, correct selected-zone time and abbreviation, and amount/currency formatting. Preview is not proof the settings apply elsewhere.
# Save Cancel and Beta Verification
Item | Review status | Developer instruction
Save Changes | Saving approved | Retest all fields and toggles after implementation. Show success only after persistence succeeds; show failures without discarding selections.
Cancel | Pending testing | Verify unsaved edits are discarded and last-saved settings are restored. Do not mark passed from the screenshot.
Branding and notifications note | Pending verification | Preserve the explanatory note directing appearance settings to Branding and personal notification choices to Notifications. Confirm accuracy; language affects standard notification text, not delivery preferences.
Scope | Required boundary | This package covers System Preferences only. Do not infer approval of other settings sections or full downstream functionality.
# Acceptance Checks
1. Save each preference, refresh, and sign in again; confirm persisted values.
2. Test selected time-zone output and daylight-saving transitions where applicable; confirm appointments and reminders remain correct.
3. Enable company Spanish with employee choice OFF; staff interface displays Spanish while clients initially see English.
4. Enable employee choice; one employee selects English while another stays Spanish. Neither affects the other.
5. Enable client choice; a client selects Spanish at signup and later changes back to English. Other clients remain unchanged.
6. Disable each individual-choice toggle and verify its baseline, including client English independent of company Spanish.
7. Test company toggle OFF with and without allowed employee overrides.
8. Check translated labels, errors, and standard notification text; verify uploaded and firm-written content is unchanged.
9. Test date and number formats in the preview and intended downstream screens; verify amounts and dates are not mutated.
10. Change currency; confirm old invoices and payments remain unchanged and new supported behavior is documented.
11. Test unauthorized toggle or preference changes through direct requests; deny cross-user and cross-firm access.
12. Test Cancel and failed saves. Record tester, date, evidence, result, and follow-up for each check.
# System Preferences Screen Reference
Reference screen before requested language controls and translation corrections. Approval statuses above are based on the owner’s reported tests.