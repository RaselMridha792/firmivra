Branding & White Labeling
Developer feedback, implementation notes & test checklist  |  18 October 2026
Scope: Settings → Branding. Statuses below reflect the owner’s live review, not independent software verification. Do not change working controls unless regression testing reveals a defect.
# 1. Confirmed working — preserve as is
No. | Control / feature | Owner feedback | Developer action
1 | Portal name | ✓ Editable / updates correctly | Retain existing edit and save flow.
2 | Client portal create-account colors | ✓ Color changes work | Preserve existing color controls and application.
3 | Company / brand colors | ✓ Customization works | Retain existing color settings.
4 | Logo for light backgrounds | ✓ Works for footer and portal emails | Do not repurpose this control for the sidebar.
5 | Logo for dark backgrounds | ✓ User located and confirmed correct option | Preserve separate dark-background asset; check sidebar contrast.
6 | Logo updating / replacement | ✓ Works | Preserve file upload and replacement behavior.
7 | Sidebar slogan | ✓ Editable / works | Keep existing behavior.
8 | Sidebar motto | ✓ Editable / works | Keep existing behavior.
9 | Save Changes | ✓ Works in user testing | Preserve current save process and persistence.
# 2. Branding destinations and expected behavior
Control | Expected action | Review status
Portal name / slogan / motto | Edit the appropriate field; Save Changes applies update. | Working per owner; regression test
Light-background logo | Upload/replace asset for footer and portal emails. | Working per owner
Dark-background logo | Upload/replace contrasting logo used on dark surfaces, including sidebar where configured. | Owner identified correct setting; verify placement
Theme / company colors | Adjust supported colors; preview if available; Save Changes. | Working per owner
Client portal create-account styling | Reflect saved supported colors on create-account page. | Working per owner
Customize Theme from Company Profile | Navigate to Settings → Branding. | Link previously confirmed; destination now reviewed
Preview Login Page from Company Profile | Show actual customer-facing login preview. | Separate integration test required
# 3. Login / client portal branding — first review accepted
Item | Requested follow-up | Acceptance criterion
Login-page customization | Confirm whether customer login-page visual customization is available under Branding or Client Portal; user found welcome-message editing in Client Portal. | Document exact existing location; avoid duplicate editor; add navigation from Branding only if agreed.
Welcome message | Preserve existing Client Portal welcome-message editor. | Saved message appears on relevant client-facing page.
Sidebar color | No change requested; keep deep blue default. | Dark-background logo remains visible; no new color picker required.
# 4. Functional developer testing
# Test matrix
ID | Test step | Expected result
B01 | Update portal name; save; reload | Updated value persists
B02 | Change create-account page color; inspect client page | Correct saved color appears
B03 | Change company brand colors; save and reload | Colors persist in intended surfaces
B04 | Replace light logo; check footer and portal emails | Correct asset appears; sidebar unaffected
B05 | Replace dark logo; check dark sidebar | Contrasting logo visible, correct size
B06 | Replace each logo with invalid file | Clear validation; existing asset retained
B07 | Edit slogan; save and reload | Text persists and displays correctly
B08 | Edit motto; save and reload | Text persists and displays correctly
B09 | Save multiple changes; log out and back in | All saved changes persist
B10 | Simulate save/network failure | Error shown; no false success; changes recoverable
B11 | Open Branding via Company Profile quick action | Correct Branding page opens
B12 | Open customer login preview | Preview matches saved customer login design
B13 | Check Client Portal welcome message | Editable and displayed in intended view
B14 | Test mobile and keyboard navigation | No clipping; controls accessible
B15 | Test authorized vs unauthorized roles | Server enforces permission boundaries
B16 | Check tenant separation | Firm A cannot edit or view Firm B branding
# 5. Developer handoff / sign-off
Developer: preserve all nine owner-confirmed working controls. Login and client portal customization are accepted for first review. FINAL LIVE-SITE VERIFICATION IS PENDING: test that saved logo and branding changes actually appear on the published website and client-facing pages. Record screenshots, results, and defects before final sign-off.
Important screenshot note: the screenshots supplied in this conversation depict Company Profile, not a verified Branding-page capture. Do not label a Company Profile image as Branding. Insert the exact Branding screenshot and numbered callouts when supplied.
Developer: __________________    Date: __________    Reviewer: __________________
6. Pending final test — published website branding synchronization
Status: NOT YET TESTED / FINAL SIGN-OFF PENDING. The owner confirmed that branding controls can be changed and saved in Settings, but has not yet verified that updated logos and company branding actually appear on the live website. Do not mark this end-to-end behavior as passed until tested.
Test ID | Action / location | Expected result | Current status
LIVE-01 | Change dark-background logo in Settings → Branding, save, then visit the actual website sidebar | New contrasting logo appears in the live sidebar; no old logo or broken image | PENDING — owner to test
LIVE-02 | Change light-background logo, save, then inspect live footer, client portal, and outgoing email template | Correct updated logo appears in each intended location | PENDING — owner to test
LIVE-03 | Update portal name, primary color and accent color, save, then open published portal/login/create-account pages | Saved text and colors match the live customer-facing pages where configured | PENDING — owner to test
LIVE-04 | Update sidebar slogan and motto, save, then open live sidebar | Saved wording appears in the intended sidebar locations | PENDING — owner to test
LIVE-05 | Refresh, use private/incognito browser, and log in on another device after changing branding | New branding persists and is visible without relying on stale browser cache | PENDING — owner to test
LIVE-06 | Revert branding to previous settings and save | Published website and portal return to the saved previous branding | PENDING — owner to test
Test evidence to capture: before-and-after screenshots of Branding Settings and each published destination, tested URL, browser/device, date/time, Pass/Fail, defect ID, and reviewer sign-off.
Approval distinction: FIRST REVIEW APPROVED — no design changes requested. FINAL WEBSITE REFLECTION TEST NOT YET COMPLETED — final acceptance remains pending.