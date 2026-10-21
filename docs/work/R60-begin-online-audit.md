# Begin Online at 1440 px: audit against `docs/mockups/begin-online/` (R60)

Screenshots and side-by-side sheets (not committed, 37 MB): `C:/Users/RASEL/AppData/Local/Temp/claude/f--firmivra-R60/4058ff7b-3b4d-4252-b861-9687650a1fe8/scratchpad/begin/shots/` and `C:/Users/RASEL/AppData/Local/Temp/claude/f--firmivra-R60/4058ff7b-3b4d-4252-b861-9687650a1fe8/scratchpad/begin/sheets/` on Rasel's laptop. Rebuild them from the mockups if that folder is gone.

Oct 21, 2026. Worktree `F:/firmivra-R60`, branch `rasel/R60-begin-online` at `5195976d` (origin/main). Audit only: no repo file was changed.

Paths below are short: `begin/` = `apps/web/src/app/portal/[firmSlug]/(public)/begin/`, `_blocks/` = `begin/_blocks/`, `(public)/` = `apps/web/src/app/portal/[firmSlug]/(public)/`, `forms/` = `packages/types/src/intake/forms/`.

## How it was run

- API on 4600 and web on 3600 (real API, local Postgres), as asked. Screens: `/lvp/begin`, all four Annual Tax steps, both `done` variants, and every empty / unreachable state.
- **The local seed gives five of the six forms a 3-step stand-in** ("About you / Documents / Review and submit", one "Full name" field): `packages/db/prisma/seed-helpers.ts:187-192` seeds the real `INTAKE_FORMS` only for Annual Tax unless `realForms` (only the demo firm, which is not seeded locally). See `shots/state-quarterly-empty-real-api.png`. So Quarterly, Bookkeeping, Payroll, Tax Planning and Business Development were shot on a **second web server on 3601 in mock mode for `beginOnline` and `publicAgreements` only** (`NEXT_PUBLIC_API_MOCK=beginOnline,publicAgreements`, `NEXT_DIST_DIR=.next/mock-r60`). The firm info, header and footer still came from the real API. Those shots carry the red "Mock data" badge at the right edge (an artefact, not a difference). Their agreements are the mock's sample agreements.
- If dev is seeded with `pnpm db:seed` and not the demo seed, dev also shows the stand-in for those five forms. Worth checking on `portal.dev.firmivra.com/lvp/begin/quarterly-tax`.
- Playwright at 1440 x 900, full page, dev-tools badge hidden, scrolled to the top before each shot. Steps were filled with synthetic data (Pat Sample, 470-555-0142, pat.sample@example.com, made-up SSN/EIN). To show the panels the Annual mockup shows, the driver chose Married Filing Jointly, Dependents = Yes, and a Business return type. Other Yes/No answers were set to "No", so conditional follow-ups stay hidden, as on a fresh form. **Submit was never clicked.** Starting Annual Tax on the real API created **three draft leads for LVP in the local DB** (one per run; no email is sent by a start).
- Sheets (`sheets/<screen>.jpg` whole page, `sheets/<screen>-pN.jpg` slices): mockup left, ours right, both scaled to the same width. Slices cut each image at the same fraction of its own height. Our pages are much taller, so later slices drift; use the whole-page sheet for structure. There are also three area-matched region sheets (`region-header.jpg`, `region-annual-panel1.jpg`, `region-yesno-rows.jpg`).
- Mapping a 1024 px mockup to 1440 px: multiply by 1.406 (the 1223 px Success mockups by 1.177). "At 1440" below means a mockup measurement scaled this way.

## Summary per screen

"Local" counts the numbered differences listed under the screen. "Shared" counts the S-items (below) that are visible on that screen. Lines marked "Not counted" restate an S-item for that screen. S27 (orange button contrast) applies to every screen and is not counted per screen.

| Screen (mockup) | Shot | Local | Shared | Total |
| --- | --- | --: | --: | --: |
| `/lvp/begin` (Begin online.png) | `shots/begin-online.png` | 13 | 6 | 19 |
| Annual 1 (Annual Intake Form 1.png) | `annual-intake-form-1.png` | 6 | 16 | 22 |
| Annual 2 (Annual Intake Business Income 2 .png) | `annual-intake-business-income-2.png` | 3 | 12 | 15 |
| Annual 3 (Annual Intake From 3.png) | `annual-intake-from-3.png` | 4 | 13 | 17 |
| Annual 4 (Annual Tax Intake Form 4.png) | `annual-tax-intake-form-4.png` | 5 | 16 | 21 |
| Quarterly 1 (business Information.png) | `business-information.png` | 6 | 15 | 21 |
| Quarterly 2 (Taxes & Income.png) | `taxes-income.png` | 5 | 18 | 23 |
| Quarterly 3 (Business Expenses.png) | `business-expenses.png` | 4 | 14 | 18 |
| Quarterly 4 (Review & Submit.png) | `review-submit.png` | 8 | 16 | 24 |
| Bookkeeping 1 (Bookkeeping intake.png) | `bookkeeping-intake.png` | 3 | 15 | 18 |
| Bookkeeping 2 (Bookkeeping Background intake.png) | `bookkeeping-background-intake.png` | 2 | 15 | 17 |
| Bookkeeping 3 (Bookkeeping Document Upload intake .png) | `bookkeeping-document-upload-intake.png` | 4 | 14 | 18 |
| Bookkeeping 4 (Bookkeeping Review  intake.png) | `bookkeeping-review-intake.png` | 2 | 13 | 15 |
| Payroll 1 (Payroll intake 1.png) | `payroll-intake-1.png` | 4 | 15 | 19 |
| Payroll 2 (Payroll intake 2.png) | `payroll-intake-2.png` | 3 | 16 | 19 |
| Payroll 3 (Payroll Review intake.png) | `payroll-review-intake.png` | 1 | 14 | 15 |
| Tax Planning 1 (Tax Planning intake 1.png) | `tax-planning-intake-1.png` | 5 | 14 | 19 |
| Tax Planning 2 (Tax  planning intake  2 .png) | `tax-planning-intake-2.png` | 4 | 14 | 18 |
| Tax Planning 3 (Tax Planning intake 3 .png) | `tax-planning-intake-3.png` | 3 | 12 | 15 |
| Tax Planning 4 (Tax planning intake 4.png) | `tax-planning-intake-4.png` | 4 | 13 | 17 |
| Business Development 1 (Development intake 1.png) | `development-intake-1.png` | 3 | 13 | 16 |
| Business Development 2 (Development intake 2 .png) | `development-intake-2.png` | 1 | 14 | 15 |
| Business Development 3 (Development intake 3.png) | `development-intake-3.png` | 2 | 15 | 17 |
| Business Development 4 (Development Intake 4.png) | `development-intake-4.png` | 4 | 14 | 18 |
| Success, Tax Prep (Success Tax Prep.png) | `success-tax-prep.png` | 8 | 6 | 14 |
| Success, others (Success Page for all services except taxes.png) | `success-page-for-all-services-except-taxes.png` | 8 | 6 | 14 |

---

## Shared differences (fix once, many screens change)

Ordered by reach. Tags: **[fix]** web-only; **[R56]** R56's files (`_blocks/form-blocks.tsx`, `_blocks/intake-grid.tsx`, control rules in `_blocks/intake-scale.module.css`); **[contract/API]** needs a contract field or route; **[decide]** the mockup conflicts with a spec, a rule or another mockup.

### S1 [fix] Page frame is narrower than the mockups (all 26)
- Mockup: content spans x 18-1006 of 1024 (about 96%), so about 1380 px at 1440 with about 30 px side gutters. On Begin, the cards span 22-1002, so about 1378 px.
- Ours: 1240 px (100 to 1340), from `min(100% - 2rem, clamp(0, 87.5vw - 1.25rem, 85rem))`. Panels are 606 px instead of about 685 px. The Begin cards are 404 x 221 instead of about 447 x 295.
- Code: `_blocks/intake-scale.module.css:39-44, 174-179`. The Success pages also cap at `max-w-4xl` (S-page notes).
- Scope: shared.

### S2 [fix] (with R56) Type runs about 75-85% of the mockup size (all 26)
- `--intake-font` is `clamp(14px, 6px + 0.625vw, 16px)`, which gives 15 px at 1440. The steps are `text-xl` 22.5, `3xl` 30, `5xl` 45 and `6xl` 60.

| Element | Ours | Mockup at 1440 |
| --- | --: | --: |
| Begin "Begin Online" text width | 345 px | 509 px |
| "Choose Your Service" | 37.5 px | about 62 px |
| Begin card title | 22.5 px | about 26-27 px |
| Form page title ("Annual Tax Intake Form": 44 px at 1024, 31 px cap) | 45 px | about 62 px |
| Panel title (20 px at 1024) | 22.5 px | about 28 px |
| Field label | 15 px | about 17.5 px |
| Button text | 15 px / 500 | about 19-21 px / semibold |
| Section badge | 44 px | about 62 px |

- Exceptions where the mockup is smaller than ours: the form subtitle under the Annual and Quarterly titles is one tiny line, about 12 px at 1440 (ours 15 px on 2 lines). The stepper circles are about 31 px at 1440 (ours 44 px, see S14).
- Code: `_blocks/intake-scale.module.css:3-7, 15-24`.
- `--intake-control` (line 8) is derived from `--intake-font`, so changing the font also changes R56's control sizes. Decouple them, or agree with R56.

### S3 [R56] + [decide] Controls and choice rows are taller than the mockups; pages are 1.4-2.2x taller (all forms)
- Text inputs: ours 44 px; mockup 25 px at 1024, about 35 px at 1440.
- Radio and checkbox rows have `min-height: 44px`. The Annual Yes/No list pitch is 52 px in ours against 18 px at 1024 (about 25 px at 1440); see `sheets/region-yesno-rows.jpg`. Checklist rows (Bookkeeping expenses, Payroll situations, Tax Planning goals) are 30-46 px against about 20-23 px.
- Page heights at 1440: Annual 1 is 3283 px (mockup scaled 2160), Annual 4 is 4760 (2160), Bookkeeping 1 is 3370 (2160).
- Code: `_blocks/intake-scale.module.css:46-57, 83-87, 129-132`, and the kit's `--container-control: 44px` (`packages/ui/src/styles.css:184`).
- Decide: the project bar is WCAG 2.1 AA (`docs/PROJECT-DRAFT-v2.md:269`), and 44 px targets are AAA (2.5.5). The mockup's 35 px fields and about 25 px choice rows meet AA. This is a kit-wide control height, so R56 and Rasel decide.

### S4 [fix] Headings and labels are azure `#005fcc`; the mockups use a deeper royal/navy blue (all 26)
- Measured in the mockups: "Choose Your" `#05207a`, card titles `#021984`, Begin subtitle `#000d6c`, Annual title `#020daa`, Annual panel titles `#000ed3`, stepper labels `#0007fd` to `#0616f7`. The hero word "Begin" is black `#000000`. Our "Begin" is `#005fcc` (`begin/_components/begin-online-screen.tsx:113, 134-139`).
- Code: `_blocks/intake-scale.module.css:27-28` (`--color-heading` and `--color-firm-primary` set to platform-blue).
- No kit colour sits between platform-navy `#001b36` and platform-blue `#005fcc`, so rule 4 allows a new token, measured at about `#0a1f8f`. The mockups vary between images; pick one value.
- Our blue passes contrast (5.98:1).

### S5 [fix] Required stars are blue, not red, in every intake field (all forms)
- Mockup: a red `*`. Ours: the star takes the label colour.
- Cause: `_blocks/intake-fields.tsx:24-26` joins the star with a no-break space, but the kit's `LabelText` reds only a trailing `" *"` with a normal space (`packages/ui/src/label-text.tsx:6`).
- The start card ("Let's get started") uses a normal space, so its stars are red: the two cards disagree.
- Fix in `intake-fields.tsx`, or let `LabelText` accept U+00A0.

### S6 [R56] + [decide] Input look
- Border: ours `#7b8fa6`, 6 px radius; mockup light blue about `#c8d6f0`, about 3-4 px radius.
- Placeholder: ours `#52647a`; mockup light blue about `#a8b8e8`.
- Labels: ours semibold (600); mockup regular.
- Native date fields show "mm/dd/yyyy" and the browser glyph; the mockup shows "MM/DD/YYYY" and a blue calendar icon.
- Month fields show Chrome's "--------- ----" (Bookkeeping 2).
- Code: `_blocks/intake-scale.module.css:55, 64-67`; the label weight is from R56's #963.
- Decide: the mockup border is 1.47:1 against white (WCAG 1.4.11 needs 3:1) and the placeholder is 1.97:1 (1.4.3 needs 4.5:1). Ours are 3.32:1 and 6.06:1. Keep ours for contrast; the weight and radius can follow the mockup.

### S7 [fix] Icons are lucide outline, not solid Phosphor (all 26)
- Every Begin Online file imports `lucide-react`: `begin-online-screen.tsx:3`, `done-screen.tsx:5-15`, `resume-screen.tsx`, `looks.ts:2-46`, `intake-layout.ts:1`, every `_blocks/*.tsx`, and `(public)/layout.tsx:4`.
- design-match rule 3 and `docs/ui-kit.md` call for solid Phosphor (`weight="fill"`). `@phosphor-icons/react` is already in `apps/web/package.json:34`.
- The mockup icons are solid, for example the Begin service and step icons, the Annual panel icons, the Bookkeeping background panels, the upload clouds and the review card badges. The Begin "trust" icons and the Success tiles are outline in the mockup too.
- The changes in `form-blocks.tsx` and `intake-grid.tsx` are R56's.

### S8 [decide] The header differs, and the mockups disagree with each other (all 26)
- Ours, on every page (`(public)/layout.tsx:115-230`, R17's file, not under `begin/`): logo 68 x 48; nav Home, Services, Resources, Begin Online (gold underline); a gold "Schedule an Appointment" 222 x 40; 65 px tall; content x 192-1248; 14 px nav text.
- The mockups:
  - `Begin online.png`: a full-width header about 104 px tall at 1440. Logo about 175 x 80. Nav Home, About Us, Services, Resources, Client Portal, Begin Online (orange underline), Contact. An orange button about 316 x 56. Nav text about 17 px, colour `#0b42ab`.
  - Annual 1, Annual 2 and Quarterly 4: the same nav without Begin Online, plus the script tagline "Plan | Prepare | Prosper" and "PEOPLE. PURPOSE. PROSPERITY." under the button.
  - Annual 3-4, Quarterly 1-3 and Bookkeeping 1-4: no nav. Logo on the left, form title centred, tagline on the right.
  - Payroll, Tax Planning and Business Development: a photo hero with logo and tagline, no nav.
  - Success: a photo background, logo and tagline, no nav.
- Missing links: About Us, Client Portal and Contact.
- Colour: the gold comes from LVP's stored accent `#c9a227`. White on gold is 2.42:1, and gold on white for "Begin Online" is also 2.42:1; both fail AA. The mockup uses orange.
- Decide one header for the form pages, and its owner (R17's layout).

### S9 [decide] + [contract/API] The footer is a different design (all 26)
- Ours: the LVP variant of `PortalFooter` (`(public)/_components/portal-footer.tsx:50-226`, R17). Blue `#1f4e79`, five link columns, office hours, "1393 Duncan Lane", "(770) 123-4567". These details are hard-coded for slug `lvp`.
- `Begin online.png`: a white footer. Logo, one link row (Home | About Us | Services | Resources | Client Portal | Begin Online | Contact), three round social icons, "© 2026 LVP Accounting and Taxes LLC. All rights reserved.", Privacy Policy | Terms of Service, and the script "Plan | Prepare | Prosper".
- Every form and Success mockup: a navy `#001a41` band with logo, "Small Business & Personal Tax Solutions You Can Trust.", (470) 555-1234, info@LVPAccounting.com, www.LVPAccounting.com, social icons, a lock, and "Secure. Confidential. Always." (or "Secure. Compliant. Confidential.") with the script tagline.
- The 555 number is a placeholder (NOTES §9).
- Contract: `PortalInfo` (`packages/types/src/client-auth/schemas.ts:42-72`) has no phone, email, website, address or social links, so a per-firm footer needs those fields.

### S10 [contract/API] + [decide] Firm marketing content is missing (photo heroes, taglines, banner scripts)
- Missing:
  - Photo heroes with slogan mugs and books (Payroll, Tax Planning, Business Development, both Success pages).
  - The LVP logo on the Begin hero laptop, and the "PLAN PREPARE PROSPER" mug.
  - Taglines: "Plan | Prepare | Prosper", "PEOPLE. PURPOSE. PROSPERITY.", "FOR A STRONGER TOMORROW".
  - Banner scripts: "Your Success Our Support", "Secure Simple Confidential", "Almost There!", "We're Here to Support Your Growth!", "People Payroll Progress!".
  - Success taglines: "Your Goals. Our Expertise. A Brighter Tomorrow." and "Small Business. Big Possibilities."
- R22's pre-review took the firm logo off the hero and the taglines off the Success pages on purpose (`docs/work/R22-begin-online.md:41`), because the pages serve every firm.
- `PortalInfo` has only `sidebarSlogan`, `sidebarMotto`, `header` and `welcomeMessage`.
- Need: per-firm tagline and motto text and per-page hero images (an upload route), or a decision to leave them out.

### S11 [decide] Conditional follow-ups are hidden; the mockups draw them on the empty form (all forms except Begin and Success)
- The mockups show every "If yes...", "If no, what is your role?", "Other (please specify)", "fiscal start month" and the inventory questions on an empty form.
- Ours hides them until the triggering answer (`showIf` in `forms/*.ts`).
- Most visible effects:
  - The Bookkeeping Inventory panel shows 1 question instead of 6, plus a red box.
  - Bookkeeping 3 has no "Inventory Records" card.
  - Quarterly 1 and 2, Payroll 1 and 2, Tax Planning 1-3 and Business Development 2-3 each lose 2-7 lines.
  - The Annual spouse, dependents and business panels appear only after their choices.
- Recommendation: keep the behaviour (it matches the API's checks), or show the follow-ups disabled.

### S12 [fix] After every step change the sticky header covers the form title (all forms)
- `go()` scrolls the form top to the viewport top (`_blocks/intake-flow.tsx:603-606`), but the LVP header is sticky and 65 px tall (`(public)/layout.tsx:117`).
- All 21 step changes I made landed at `scrollY 81`, `h1 top 0`, `header bottom 65`, so the title sits under the header.
- Fix: `scroll-margin-top` on the target, or scroll to 0.

### S13 [fix] Phone numbers are shown raw
- The start card's phone fills the form as E.164 "+14705550142". This shows in the step input (Annual 1, Quarterly 1, Bookkeeping 1, Payroll 1, Tax Planning 1, Business Development 1) and in every review. A typed phone shows as raw digits ("4705550142").
- Mockup: "(470) 555-1234".
- Code: `_blocks/intake-fields.tsx:359-389` (the value is shown as stored) and `_blocks/intake-review.tsx:74-75` (the default branch returns the raw string).

### S14 [R56] Stepper
- Circles: ours 44 px; mockup about 31 px at 1440.
- Labels: ours 15 px semibold `#005fcc`; mockup about 17 px and deeper blue.
- A completed step shows its number. The Business Development 2 mockup shows a check; the other mockups show numbers.
- The current label is serif bold on Tax Planning; ours is sans.
- Code: `_blocks/form-blocks.tsx:320-367`.

### S15 [decide] Step labels follow the definition; the mockups word them differently per screen
- Annual: "Personal & Filing" / "Personal and Filing"; "Review & Sign Agreement" / "Review & Sign Service Agreement" / "Review and Sign Agreement".
- Quarterly: "Taxes and Income" / "Taxes & Income" / "Income & Deductions"; "Review and Sign" / "Documents" / "Review & Submit". Also "Step 3 of 3" on the review.
- Payroll: "Documents & Review" / "Review & Sign Service Agreement".
- NOTES §9 lists these as the mockups' own inconsistencies. Keep one canonical set (the current one).

### S16 [R56] "Edit" buttons on the reviews
- Ours: orange outline buttons (`_blocks/form-blocks.tsx:387-395`, and the review rows).
- Mockups:
  - Annual and Bookkeeping: blue outline buttons.
  - Quarterly: white buttons on the coloured bands.
  - Payroll: one "Edit" link in the panel header.
  - Tax Planning: "Edit" links per row and an "Edit All Sections" link.
  - Business Development: "Edit" links.

### S17 [R56] Empty answers say "Not provided" on Annual; "N/A" everywhere else
- Mockups: "N/A".
- Ours: Annual review "Not provided" (`_blocks/form-blocks.tsx:417`); the by-step reviews "N/A" (`_blocks/intake-review.tsx:535, 697`).

### S18 [fix] + [decide] Footer buttons of each step
- Ours (`_blocks/intake-flow.tsx:897-948`): Back and the save-later button on the left, Continue on the right, 44 px tall, 15 px/500 text.
- Mockups: buttons about 46 px tall with about 20 px semibold text.
  - Tax Planning and Business Development centre "Previous" with a large "Next Step" and the "Save and Continue Later" link.
  - Their reviews centre Previous and Submit, with "Your information is secure and confidential." and a lock under them. Ours hides that line (`looks.ts:629, 768` `reviewNote: hidden`, but it is not shown anywhere else).
  - The Bookkeeping, Payroll and Annual 3 mockups draw Back as a navy outline; ours is orange.
- Decide: save-later shows on every step (`WORDING` `intake-flow.tsx:247-294`). The mockups have it only on Bookkeeping 1 ("Save & Exit"), Payroll 1 ("Exit Form"), and Tax Planning and Business Development 1-3. Annual and Quarterly mockups have none, and none of the reviews do except Tax Planning and Business Development.

### S19 [contract/API] + [decide] Agreement and signature block
- Ours (`_blocks/intake-agreement.tsx:188, 204, 276-310`): the firm's R14 block. Title "Service Agreement", the agreement's own tick boxes, "I accept the Terms of Service and Privacy Policy", then Full Name *, "Signature (type your full name) *", Title / Position (optional), and Date = today as read-only text.
- Mockups:
  - Annual: one tick box, "Signature (Type or Draw)*" with Clear, and a Date* picker.
  - Quarterly: "Client Agreement", one certify box, Full Name*, Title/Position (if applicable), Date* picker, Signature (typed).
  - Bookkeeping: one box, "Full Name (Type your name to sign)*", Title/Position* (required), a prefilled Date*, and a "By signing, you acknowledge..." note.
  - Payroll: an embedded PDF viewer (page 1/12, zoom, search, download), then "4. Confirm & Sign" with 4 fixed required boxes, Full Name*, Date*, and "Your Signature* (Type or draw)" with Clear.
  - Tax Planning: a summary scroll box with "View/Download Full Agreement", 6 fixed boxes (Terms link, accurate, no guarantee, authorize, Privacy link, consent to phone, email and text), and a "Your Signature" card with Date*, a typed line, Full Legal Name* and Email Address (for confirmation)*.
  - Business Development: an inline 7-clause agreement in two columns, View/Download, one box, a "Client Signature" card, Date*, Full Legal Name* and Email (for confirmation)*.
- Contract: a drawn signature image and an "Email (for confirmation)" field are not in `IntakeSignatureInput`.
- Decide:
  - A typed date versus the server's date (ours is better for the audit trail).
  - Which tick boxes are fixed per form and which come from the firm's agreement.
  - Whether to show Title / Position where the mockup has none (Payroll, Tax Planning, Business Development).
  - A PDF viewer is web-only; the block has the original PDF.

### S20 [fix] Review content
- Annual: one card per panel of every step with every question (18 cards). The mockup has 7 summary cards, with Document Name / File Name / Date Uploaded tables.
- Quarterly and Business Development (by-step): each question is used as the label (for example "Doing Business As (DBA) (if applicable):"). The mockups use short labels ("Business Legal Name:", "Owner Name:").
- Code: `_blocks/intake-review.tsx:85-130, 425-470`, and the review blocks in `looks.ts`.

### S21 [decide] (then [contract/API]) Reviews show fields the forms never collect (NOTES §9)
- Annual: Occupation, Tax Year, Type of Work / Income Source, Primary Business Activity.
- Quarterly: Owner Name (ours adds "Your Full Name" to step 1), Ownership %, Type of Business.
- Business Development: Website, Fiscal Year Start (alongside Calendar Year), Bookkeeping Needs.
- If they are kept, each needs a field in `forms/*.ts`.

### S22 [fix] The header block of each step
- Ours (`_blocks/intake-flow.tsx:138-157, 746-761`) always shows the form subtitle, the lock bar, then the step title and subtitle.
- Mockups:
  - Annual 2: replaces the subtitle and lock bar with "Business Income & Expenses" and its line.
  - Quarterly 2-4: "Step N of 4 – ..." plus one line, no lock bar.
  - Bookkeeping 2-4: no lock bar.
- The lock bar is `max-w-2xl` (672 px), so it wraps to 2 lines. The mockup bar is about 720 px on one line (`intake-flow.tsx:147`).
- The Annual and Quarterly form subtitle is one small line in the mockup (`intake-flow.tsx:146`).

### S23 [fix] + [decide] Upload zones and example lists
- Zone text: ours is generic ("Click to upload / or drag and drop files here / (Upload as many as needed)", `_blocks/intake-upload.tsx:225, 251-254`). The mockups word each zone:
  - "Click to upload income documents", "...deduction/credit documents", "...business documents", "...business EIN/formation documents".
  - "Drag and drop files here or click to upload" with "Accepted file types: ..." and a Choose Files button (Business Development 3).
  - "Drag and drop files here / or click to upload" (Payroll 2).
- Examples title: ours is "Examples of {field label}:" (`intake-upload.tsx:276`). The mockups say "Examples of Income Documents:", "Examples of Deduction/Credit Documents:", "Examples of Business Documents:", "Examples of helpful documents:" and "Examples of documents you may upload:".
- Payroll 2 and Business Development 3 use orange tick markers where ours uses bullets.
- Upload icon: ours is an outline cloud; the mockup's is a solid filled cloud.
- Decide: our accepted-formats lines list Excel and Word (Quarterly 2-4, Bookkeeping 3). The mockups say "PDF, JPG, PNG, Excel (XLS/XLSX)" (Quarterly) and "PDF, JPG, or PNG" (Bookkeeping). This comes from each slot's accept list in `forms/*.ts`.

### S24 [fix] The textarea counter is hidden until something is typed
- `_blocks/intake-fields.tsx:581-586` makes it `sr-only` when empty, with the comment "the mockups' empty fields have none".
- But the Bookkeeping 3 and Payroll 3 mockups show "0/1,000" on the empty field.

### S25 [fix] Repeating groups start with no row
- Quarterly "Estimated State Tax Payments", Bookkeeping "Business Assets" (the mockup shows 2 empty rows) and "System Access" (1 row) show only the add button.
- Code: `_blocks/intake-values.ts:95-101` (`[]` without answers); `_blocks/intake-group.tsx`.
- Fix: render one empty row that is not sent until it is filled.

### S26 [fix] "Add Another ..." buttons are orange dashed; the mockups' are blue
- Ours: orange dashed (`_blocks/intake-group.tsx:216-222`).
- Mockups: Annual, a blue dashed border with blue text; Quarterly and Bookkeeping, a blue outline with a plus-circle.

### S27 [decide] White text on the orange buttons fails AA
- White on our `#f26a21` is 3.06:1. The mockup oranges are 3.11:1 (`#fd5d01`) and 3.27:1 (`#db7201`).
- For 15-21 px text, AA needs 4.5:1, or 3:1 only at 18.66 px bold or 24 px.
- Accent words in orange on white (the "Intake Form" title tails, "Online", the orange Edit labels) are also 3.06:1.

---

## Per screen

### `/lvp/begin`: `Begin online.png` (sheets `begin-online*.jpg`, `region-header.jpg`)
Shared: S1, S2, S4, S7, S8, S9. Local (all in `begin/_components/begin-online-screen.tsx` unless noted, all **local**):
1. [fix] The hero body text ends "...to get started." The mockup ends "...to get started with LVP Accounting and Taxes." (:143-148; use `business.name`).
2. [fix] "Begin" is black in the mockup; ours `#005fcc` (:134-139). "Online" is orange in both.
3. [fix] The subtitle "Complete your intake form..." is deep navy `#000d6c` in the mockup; ours `#005fcc` (:140-142). Ours is about 71% of the mockup's width (414 px against 582 px).
4. [contract/API] (S10) The laptop screen in the mockup shows the LVP logo above the three ticks, the mug reads "PLAN PREPARE PROSPER", and there is a pen. Ours (`begin-hero.png`) has no logo, a blank mug and no pen (removed on purpose in #287).
5. [fix] The hero CTA is about 426 x 62 at 1440 in the mockup, with the calendar icon in a lighter inset box; ours is 278 x 44 with a plain icon (:98-109).
6. [fix] Service cards: about 447 x 295 at 1440 in the mockup; ours 404 x 221. The icon disc is about 105 px against our 64 px (:172-184).
7. [fix] (S7) Card icons in the mockup are solid navy: a document with a pen, a calculator, a group of three people, a bar chart with an arrow, a calendar grid, and a light bulb. Ours are lucide outline in blue (`FilePenLine`, `Calculator`, `UsersRound`, `ChartNoAxesCombined`, `CalendarDays`, `Lightbulb`; :13-48).
8. [fix] The card text wraps to narrower lines in the mockup (2-4 lines per card); ours runs 1-2 lines because our cards are wider relative to the type.
9. [fix] "4 Simple Steps" icons: the mockup uses a solid document, a solid people group, an outline cloud-up and an outline check-circle; ours are all outline (:55-80). The badges and arrows match.
10. [fix] The lock in the note box is solid black in the mockup; ours is an outline `LockKeyhole` (:253).
11. [fix] The "Same Goals / Bigger Possibilities!" text is a handwritten script, rotated about -10°, with an orange brush underline in the mockup. Ours is Playfair italic with a straight underline (:280-286). `--font-script` exists in the kit.
12. [fix] The Ready band corners have soft orange light streaks in the mockup; ours has two flat, rotated brown bars (`bg-accent/35`, :269-276).
13. [fix] The "Ready to Get Started?" CTA is about 370 x 54 at 1440 in the mockup; ours 278 x 44.
- Not counted (see S8): the header nav items, height and colour. The mockup header button is orange; ours is gold.
- Not counted (see S9): the white mockup footer against our blue 5-column footer.
- Same in both: the eyebrows and rules, the section order, the six titles, taglines and buttons with their alternating orange and navy colours, the steps' order and copy, the note text, and the trust icons (outline orange in both).
- "Schedule an Appointment" count: see the end of this file.

### Annual 1: `Annual Intake Form 1.png` (sheets `annual-intake-form-1*.jpg`, `region-annual-panel1.jpg`, `region-yesno-rows.jpg`)
Shared: S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, S11, S13, S14, S18, S22, S26. Local:
1. [fix] local: the form subtitle is one small line (about 12 px at 1440) in the mockup; ours is 15 px on 2 lines (`intake-flow.tsx:146`).
2. [decide] local: Spouse Full Legal Name, Spouse SSN and Date of Birth carry `*` in ours once the filing status is married; the mockup has no stars on spouse fields (`forms/annual-tax.ts`, spouse section about :85-107).
3. [fix] local: "Your Legal Status in the U.S." is 4 options on one line in the mockup; ours wraps "Other" to a second line (`looks.ts` `personal`; option gaps).
4. [fix] local: the dependent tick boxes are 4 in one row in the mockup; ours puts "Qualifies for Child Tax Credit" on a second line (`looks.ts:82`).
5. [decide] local: Business EIN has a show/hide eye in ours (masked like an SSN); the mockup draws a plain "__-_______" without an eye.
6. [fix] local: our lone Business 1 row has a trash button ("Remove business 1"); the mockup has none (`intake-group.tsx:106,155`, `rows.length > minItems`).
- Not counted (see S3): the Deductions and Income panels are about 640 px tall in ours and about 410 px at 1440 in the mockup.
- Not counted (see S18): "Save and Continue Later" shows; the Annual mockups have no save-later on any step.
- Not counted (see S8, S10): the mockup header carries the tagline "Plan | Prepare | Prosper" and "PEOPLE. PURPOSE. PROSPERITY." under the button; ours has none.
- Same: the 5 panels in two columns with their order, the badges, the panel icons, "Type of Tax Return(s) You Need" in a tinted box, the comments bar, the "Important:" note with Continue, and the field order in every panel.

### Annual 2: `Annual Intake Business Income 2 .png` (sheets `annual-intake-business-income-2*.jpg`)
Shared: S1, S2, S3, S4, S7, S8, S9, S10, S12, S14, S18, S22. Local:
- Not counted (see S22): the mockup header block is title, "Business Income & Expenses" and its line. Ours adds the form subtitle and the lock bar above them (`intake-flow.tsx:138-157, 746-761`).
1. [R56] shared: currency cells. The mockup draws "$" at the left of the cell and a "0.00" placeholder; ours shows a "$0.00" placeholder (`intake-grid.tsx:172`). Rows are 48 px in ours and about 26 px at 1440 (S3).
2. [contract/API] (copy only) local: the Wages table header is "Description" and then a blank column in the mockup; ours "Description" and "Description (optional)" (`forms/annual-tax.ts:24-28`).
3. [fix] local: the Income Taxes Paid icon is an orange document with a "$" in the mockup; ours is lucide `ReceiptText` (`looks.ts:108`).
- Not counted (see S18): save-later shows.
- Same: the 4 tables, their row labels and description placeholders, the Total Business Income row, the two-column Business Expenses with the Total, and Back with Continue.

### Annual 3: `Annual Intake From 3.png` (sheets `annual-intake-from-3*.jpg`)
Shared: S1, S2, S4, S6, S7, S8, S9, S10, S12, S14, S18, S22, S23. Local:
1. [decide] local: each identity tile shows "Please explain why..." all the time in the mockup; ours shows the reason box only after "I don't have this document" is ticked (`intake-upload.tsx:293-316`).
2. [contract/API] (copy only) local: the Income Documents subtitle in the mockup ends "(Examples: W-2, 1099-NEC, 1099-MISC, 1099-INT, 1099-DIV, 1099-R, K-1, SSA-1099, etc.)"; ours ends after "...that apply to you." (`forms/annual-tax.ts:416`).
3. [decide] + [contract/API] local: Business Income & Expenses Documentation.
   - Mockup: the subtitle "Upload business-related documents if applicable.", and a starred "Required for Business Filings:" box with 2 bullets under the examples. No star and no "I don't have this document".
   - Ours: that text is the subtitle, and the slot is required with "I don't have this document" (`forms/annual-tax.ts:453-460`).
4. [fix] local: the example columns split 8 + 5 in the mockup (W-2 to SSA-1099, then 1095-A to Other); ours splits 7 + 6 (CSS columns in `intake-upload.tsx`).
- Not a difference to fix: the Deductions badge is the number "3" in the mockup while the others are icons (a mockup inconsistency, NOTES §9). Ours is consistent.
- Not counted (see S18): save-later shows.
- Same: the "Required Document Uploads" heading and text, the Important box with its 5 bullets, 5 identity tiles with their labels and help text, the 4 category zones with their examples, and the certification bar.

### Annual 4: `Annual Tax Intake Form 4.png` (sheets `annual-tax-intake-form-4*.jpg`)
Shared: S1, S2, S3, S4, S7, S8, S9, S10, S12, S13, S16, S17, S18, S19, S20, S21. Local:
- Not counted (see S20): card set and order.
   - Mockup (7): Personal, Spouse, Dependents table, Filing, Income Documents table, Deductions & Credits Documents table, Business Information with a Business Documents table.
   - Ours (18): Personal & Filing (personal and filing mixed), Spouse, Dependents, Deductions & Credits Yes/No, Income Yes/No, Business, Comments, the 4 business tables, the 5 document cards, and Certification.
   - Code: `looks.ts` `ANNUAL_TAX` has no review block; `intake-review.tsx`.
1. [fix] local: documents show as "Your Government ID: Not available: <reason>", and files as names joined with commas (`intake-review.tsx:88-93`). The mockup has Document Name / File Name / Date Uploaded tables.
2. [decide] local: the mockup's SSN row has an eye to reveal it. Ours shows "•••-••-9999" only (the API returns `{ last4 }`), which keeps the SSN off the screen.
3. [fix] local: addresses read "Sample answer, Lawrenceville, Alabama, 30043" in ours: the full state name and a comma before the ZIP. The mockup reads "123 Main St, Lawrenceville, GA 30043" (`intake-review.tsx:66-67`, `stateName`; the address join at `:437-440`).
4. [fix] local: card badges are navy circles with white icons in the mockup (Personal, Filing, Income, Deductions, Business) and orange people icons (Spouse, Dependents); ours are small orange outline icons.
5. [fix] local: the payment option titles are semibold blue in the mockup; ours are regular. The tinted panel and the 3 options otherwise match.
- Not counted (see S18): save-later shows.
- Not counted (see S3, S20): the page is 4760 px tall in ours and 2160 px at 1440 in the mockup.
- Same: the "Review Your Information" heading with the "4" badge, "Edit Information" at the top right, the dependents table columns, and "How would you like to pay for your service?" with its 3 option texts.

### Quarterly 1: `business Information.png` (sheets `business-information*.jpg`)
Shared: S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, S11, S13, S14, S15, S18. Local:
1. [decide] local: ours adds "Your Full Name *" and the hint "The owner, or the person we should contact about this filing." to Business Structure & Ownership. The mockup has no such field (it feeds the review's "Owner Name", S21; `forms/quarterly-tax.ts`).
2. [fix] local: Business Structure options split left Sole Proprietorship, Partnership, S Corp and right C Corp, LLC SM, LLC MM, Other in the mockup (3/4). Ours splits 4/3 (`looks.ts:149`, CSS columns).
3. [contract/API] (copy only) local: placeholders. The mockup has "Enter your website URL", "Enter your business street address", "Enter city", "Enter state" and "Enter ZIP code". Ours has "https://www.yourwebsite.com", "Street Address", "City", a State select and "ZIP Code".
4. [decide] local: EIN shows a mask "__-_______" with an eye in ours; the mockup has the placeholder "XX-XXXXXXX" and no eye.
5. [fix] local: the amount inputs have a "$" adornment and "Enter amount" / "Enter estimated amount" placeholders in the mockup; ours shows a "$0.00" placeholder.
6. [fix] local: the note beside Continue starts "Why we ask:" in bold in ours; the mockup has no label (`intake-flow.tsx:884`; the label "Why we ask" at `forms/quarterly-tax.ts:185`).
- Same: the six numbered panels plus "Business Industry & Services", their column order (left 1, 3, 5; right 2, Industry, 4, 6), the field order, the quarter tick boxes and the Yes/No questions.

### Quarterly 2: `Taxes & Income.png` (sheets `taxes-income*.jpg`)
Shared: S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, S11, S12, S14, S15, S18, S22, S23, S25. Local:
- Not counted (see S22): the mockup's header block is "Step 2 of 4 – Taxes & Income Information" plus one line, with no "Let's get started" and no lock bar. Ours repeats the form subtitle and the lock bar.
1. [decide] local: the Filing Period panel.
   - Mockup: the quarter tick boxes again, "What is your business's tax year?*", Start/End, calendar Yes/No and the fiscal month.
   - Ours: Start/End and calendar Yes/No only.
   - NOTES §4 calls the repeated quarters a duplicate.
- Not counted (see S25): Estimated State Tax Payments shows one state row (State, Q1-Q4 amount and date) and "Add Another State" in the mockup; ours shows only the button.
2. [R56] shared: Gross Receipts has a "Quarter / Amount" header row in ours; the mockup has none (`intake-grid.tsx`).
3. [R56] + [contract/API] (copy only): the Payroll Taxes header reads "Tax Type | Q1 (Jan – Mar)..." in the mockup and "Description | Q1 | Q2..." in ours. Our row labels wrap to 2-3 lines because the first column is narrow; the mockup keeps one small line (`intake-grid.tsx:72`; column labels in `forms/build.ts` `quarterColumns`).
4. [fix] local: Upload Supporting Documents has an info box at the right of its header in the mockup ("Please ensure all documents are clear... You can upload multiple files."). Ours puts it in the subtitle.
5. [fix] local: icons. The mockup has a US flag in colour for Federal and an orange US map for State; ours has an orange flag outline and a map pin.

### Quarterly 3: `Business Expenses.png` (sheets `business-expenses*.jpg`)
Shared: S1, S2, S3, S4, S7, S8, S9, S10, S12, S14, S15, S18, S22, S23. Local:
- Not counted (see S22): the header block is "Step 3 of 4 – Business Expenses for Each Quarter" plus one line in the mockup; ours has subtitle, lock bar and "Business Expenses".
1. [contract/API] (copy only) local: the blue callout at the panel's top right, "Provide the best estimate for each quarter. Your entries help us prepare your quarterly tax filing accurately.", is missing. There is no such info field in `forms/quarterly-tax.ts`.
2. [R56] shared: the Q2 column tint is yellow `#fff0c2` in ours and peach `#fef3e6` in the mockup (`intake-grid.tsx:37`, `warning-soft`). Q1 `#e1eefd`, Q3 `#def3ea` and Q4 `#e9e3fd` are close to ours.
3. [R56] shared: the totals take each column's colour in the mockup (blue, orange, green, purple); ours are all navy (`intake-grid.tsx:202-205`).
4. [fix] local: the Upload panel's info box sits at the right in the mockup; ours is in the subtitle. The formats line adds Word (S23).
- Same: the 15 categories, their hints and order, the per-row icons (lucide here, solid in the mockup, S7), the "Total Business Expenses (This will auto-calculate)" row, Additional Notes, and "Continue to Documents".

### Quarterly 4: `Review & Submit.png` (sheets `review-submit*.jpg`)
Shared: S1, S2, S4, S7, S8, S9, S10, S12, S13, S15, S16, S18, S19, S20, S21, S22. Local:
1. [fix] local: the band titles are Business Information (navy), "Income & Deductions" (orange) and Business Expenses (a light-blue gradient) in the mockup. Ours has "Taxes & Income" (the step title) and a darker blue band for Expenses.
2. [fix] local: empty grids are dropped from the by-step cards, and the expense totals are not summarised (`intake-review.tsx:444-458` skips empty cells and lists filled ones cell by cell). The mockup shows "Q1 Total Expenses: $12,500, Q2: N/A..." and "Q1 Gross Income...".
3. [decide] local: the EIN is masked "••-•••6789" in ours; the mockup shows "12-3456789".
4. [contract/API]: the uploaded-documents table.
   - Mockup columns: File Name, Quarter, Document Type, Date Uploaded, with file-type icons.
   - Ours: File Name, Document Type (the slot label), Date Uploaded (`intake-review.tsx:557-630`).
   - Quarter (and a document type the visitor picks) needs a tag on `IntakeUpload` and `CreateIntakeUploadRequest` (`packages/types/src/intake/schemas.ts:110-119`).
   - The mockup title has "(Optional)" and an Edit button; ours showed no Edit (no files).
5. [contract/API] (copy only): the "Upload Additional Supporting Documents (Optional)" text reads "If you have any other documents that may support your intake (e.g., additional statements, prior filings, correspondence), upload them here." in the mockup and "Upload any other documents that support your quarterly filing." in ours.
6. [fix] local: the agreement title is "Client Agreement" in the mockup and "Service Agreement" in ours (`looks.ts` `QUARTERLY_TAX` has no `agreementTitle`).
7. [fix] local: the signature fields are squeezed. Full Name, Signature, Title and Date share one row in the 600 px right column, each input about 75 px wide (`intake-agreement.tsx:282`, `sm:grid-cols-2 lg:grid-cols-4` when not `stacked`). The mockup has Full Name | Title | Date in a row and the Signature at full width below.
8. [fix] local: Back and Submit sit under the agreement in the right column in the mockup; ours are a page-wide footer (`intake-flow.tsx:897`).
- Not counted (see S18): save-later shows.

### Bookkeeping 1: `Bookkeeping intake.png` (sheets `bookkeeping-intake*.jpg`)
Shared: S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, S11, S13, S14, S25, S26. Local:
1. [fix] local: package cards.
   - Card backgrounds: Starter and Premium are white in the mockup and light blue in ours.
   - The "Most Comprehensive" tag is blue in the mockup and orange in ours.
   - Growth's tagline is navy in the mockup and orange in ours.
   - Titles are about 31 px at 1440 in the mockup and about 22 px in ours.
   - The ticks are solid orange circles in both, but larger in the mockup.
   - Code: option cards in `intake-fields.tsx`.
2. [fix] local: the Business Industry placeholder is cut off ("e.g., Retail, Construction, Consult") because its column is 5/12 (`looks.ts:252`).
- Not counted (see S11): "Other (Please specify)" has its text input beside it in the mockup; ours appears only once ticked.
3. [fix] local: the Save & Exit button is a navy outline with a save icon in the mockup; ours is a blue outline (close).
- Same: the "1 Contact Information" and "1 Business Information" pair (the mockup numbers both 1), packages 2, panels 3-6 and their order, the "do not enter passwords" note card, and "Continue to Business Background Details".

### Bookkeeping 2: `Bookkeeping Background intake.png` (sheets `bookkeeping-background-intake*.jpg`)
Shared: S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, S11, S12, S14, S18, S22. Local:
1. [decide] local: Yes/No answers are radios in ours; the mockup uses text inputs "Please type yes or no". NOTES §5 says they should be radios, so keep ours.
2. [contract/API] (copy only) local: hint placeholders "e.g., 09/2026", "e.g., 1", "e.g., 0", "e.g., $5,000", "e.g., Georgia" and so on are missing (`forms/bookkeeping.ts`).
- Not counted (see S11): the Inventory panel is the red-edged tinted panel in both, but ours shows 1 of its 6 lines and no red "I don't have my inventory organized yet" box until Yes.
- Not counted (see S18): "Back to Previous Step" is a navy outline in the mockup and orange in ours. Ours adds "Save & Exit"; the mockup's step 2 has none.
- Same: the navy banner with the orange "2", the 11 numbered panels in 3 columns with icons first, and their titles and order.

### Bookkeeping 3: `Bookkeeping Document Upload intake .png` (sheets `bookkeeping-document-upload-intake*.jpg`)
Shared: S1, S2, S4, S7, S8, S9, S10, S11, S12, S14, S18, S22, S23, S24. Local:
1. [fix] + [contract/API] (copy only) local: the info box.
   - Mockup: a blue (i) icon, "**Accepted file types:** PDF, JPG, PNG (Max file size: 10 MB per file)", and a second line "All documents are securely uploaded and encrypted...".
   - Ours: an orange (i), the label on its own line, and a longer text that adds the "I don't have this document" sentence.
2. [fix] local: the upload card icons sit in discs of about 84 px at 1440 in the mockup; ours are about 40 px.
3. [decide] local: ours puts "I don't have this document" under the 3 required uploads and drops the mockup's "you can skip it for now and provide it later" sentence. The mockup has neither box; NOTES §5 flags the conflict between the stars and "skip".
4. [decide] local: the accepted formats. Ours lists "PDF, JPG, PNG, Excel (.xlsx) or Word (.docx)"; the mockup says "PDF, JPG, or PNG (Max 10 MB)".

### Bookkeeping 4: `Bookkeeping Review  intake.png` (sheets `bookkeeping-review-intake*.jpg`)
Shared: S1, S2, S4, S7, S8, S9, S10, S12, S14, S16, S18, S19, S22. Local:
1. [contract/API] (copy only) local: the banner subtitle is "Please review your information, uploaded documents, and our agreement before submitting." in the mockup and "Review your information and sign." in ours (the step subtitle).
2. [fix] local: the "By signing, you acknowledge that you have read, understood, and agree to be bound by this Agreement." info note under the Date is missing.
- Not counted (see S19): Title/Position is required (*) in the mockup and optional in ours.
- Not compared: the uploaded-documents list with View/Replace, because there were no files. Our empty text is "No documents uploaded yet."
- Same: the banner, "1. Review Your Information" with 2 rows, "2. Review Your Uploaded Documents", "3. Review & Confirm" with 3 boxes, "4. Review & Sign Our Agreement" in the right column, and "Back to Document Upload".

### Payroll 1: `Payroll intake 1.png` (sheets `payroll-intake-1*.jpg`)
Shared: S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, S11, S13, S14, S15, S18. Local:
1. [fix] local: the hero. The mockup sets the title left of a photo: "· PAYROLL · SERVICES ·", a very large navy "Intake Form", its two lines, and the stepper with hints on the photo. Ours is centred with no photo, and "Intake Form" is `#005fcc` (`intake-flow.tsx:116-136`).
2. [decide] local: Payroll Service Needs starts with "When would you like to start payroll services?*" (a date) in the mockup; ours asks it only on step 2 ("Desired start date"). NOTES §6 calls it a duplicate.
3. [decide] local: Additional Information asks "Do you currently work with another payroll provider?*" and the reason in the mockup; ours asks it on step 2 only (a duplicate per NOTES §6).
4. [contract/API] (copy only) local: placeholders "(000) 000-0000", "XX-XXXXXXX" and "Select business structure" in the mockup; ours "( ) -", "__-_______" and "Select one".
- Not counted (see S10): the banner has the script "We're Here to Support Your Growth!" at its right in the mockup.

### Payroll 2: `Payroll intake 2.png` (sheets `payroll-intake-2*.jpg`)
Shared: S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, S11, S12, S14, S15, S18, S23. Local:
1. [fix] local: the hero lines change per step in the mockup ("Let's get your payroll running smoothly." and "Accurate Payroll. Compliant Business. Peace of Mind."). Ours keeps step 1's lines (`looks.ts:365` `tagline`; the definition's subtitle).
2. [fix] local: the mockup's stepper on steps 2-3 has no hints under the labels; ours keeps the hints. Step 1's mockup has them, so this is a mockup inconsistency (minor).
3. [contract/API] (copy only) local: count placeholders "e.g., 10", "e.g., 7", "e.g., 3" and "e.g., 2" are missing.

### Payroll 3: `Payroll Review intake.png` (sheets `payroll-review-intake*.jpg`)
Shared: S1, S2, S4, S7, S8, S9, S10, S12, S14, S15, S16, S18, S19, S24. Local:
1. [decide] local: the agreement is an embedded PDF viewer in the mockup (page 1/12, zoom, search, download); ours shows the text and "Download original (PDF)". A viewer would be web-only.
- Not counted (see S19): "4. Confirm & Sign" is its own panel in the mockup, with 4 fixed boxes, a Date picker and "Your Signature (Type or draw)" with Clear. Ours folds the acknowledgments into the agreement panel and shows Title / Position, which the mockup has none of (S19).
- Not counted (see S16): Review Your Information has one "Edit" link in its header and chevron rows in the mockup; ours has an Edit button on every row.

### Tax Planning 1: `Tax Planning intake 1.png` (sheets `tax-planning-intake-1*.jpg`)
Shared: S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, S11, S13, S14, S18. Local:
1. [fix] local: the title is on two lines ("Tax Planning / Intake Form") over a photo in the mockup; ours is one line, no photo (`intake-flow.tsx:86-114`).
2. [fix] local: the "* Required Fields" note at the top right of Client & Contact Information is missing.
3. [contract/API] (copy only) local: the panel title is "Business Information (If Applicable)" with "If this doesn't apply to you, you can skip to the next section." in the mockup; ours is "Business Information" with "Tell us about your business." Ours also shows the panel only after Business or Both (S11).
4. [contract/API] local: Tax Year is a select ("Select an option") in the mockup and a text input in ours (`forms/tax-planning.ts`).
5. [decide] local: "Are you seeking tax planning for?" and "Do you currently have a bookkeeper or accountant?" are drawn as tick boxes in the mockup; ours are radios. NOTES §7 says they are single choice, so keep ours.

### Tax Planning 2: `Tax  planning intake  2 .png` (sheets `tax-planning-intake-2*.jpg`)
Shared: S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, S11, S12, S14, S18. Local:
1. [decide] local: the mockup's Personal Income column also has "Tax year of most recent return" (a select). Ours asks it only in Current Tax Information, as a text input.
2. [fix] local: the amount fields read "$ 0.00" (a separate "$") in the mockup and "$0.00" in ours.
3. [contract/API] (copy only) local: ours adds the help "Enter a refund as a positive amount and an amount owed as a negative amount."; the mockup has none (keeping it is reasonable).
4. [fix] local: Additional Financial Details is 3 columns in the mockup (Yes/No, "If yes, please describe:", "Anything else"); ours is 2 because the middle one is hidden (S11).

### Tax Planning 3: `Tax Planning intake 3 .png` (sheets `tax-planning-intake-3*.jpg`)
Shared: S1, S2, S3, S4, S7, S8, S9, S10, S11, S12, S14, S18. Local:
1. [fix] + [contract/API] (copy only) local: Upcoming Changes.
   - Mockup: the side card "Life changes. So do tax opportunities. Let us know what's ahead so we can help you plan with confidence." with a chart icon, and the subtitle "Let us know about any expected changes that could affect your tax situation. (Select all that apply)".
   - Ours: no card, and the subtitle "Life changes. So do tax opportunities. Let us know what's ahead."
2. [fix] local: "Have a specific question?" is a card with orange chat bubbles, a serif title and a subtitle in the mockup; ours is a plain label in a warm box (`looks.ts:619`, `warm`).
3. [contract/API] (copy only) local: "(Select all that apply)" is missing from the Goals and Concerns subtitles.

### Tax Planning 4: `Tax planning intake 4.png` (sheets `tax-planning-intake-4*.jpg`)
Shared: S1, S2, S4, S7, S8, S9, S10, S12, S14, S16, S18, S19, S20. Local:
1. [contract/API] (copy only) local: the hero line is "You're one step away from a smarter tax strategy. Please review your information, read and sign the service agreement, and submit your form." in the mockup and "Your information is secure and confidential." in ours (`forms/tax-planning.ts:477`).
2. [fix] local: the review rows are titled "1. Client & Business Profile", "2. Income & Financial Information" and "3. Planning Goals & Opportunities", with icons in discs and Edit links. Ours uses the unnumbered step titles ("Client, Business & Tax Profile"), Edit buttons, and no "Edit All Sections".
3. [fix] local: "View/Download Full Agreement" is a button at the agreement panel's header in the mockup; ours has "Download original (PDF)" inside.
4. [fix] local: "Your information is secure and confidential." with a lock under the centred buttons is missing (`looks.ts:629` hides `reviewNote`).

### Business Development 1: `Development intake 1.png` (sheets `development-intake-1*.jpg`)
Shared: S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, S13, S14, S18. Local:
1. [fix] local: "Personal & Business Information" is a large heading (about 37 px at 1440) with "Tell us a little about yourself and your business. Fields marked with * are required." in the mockup. Ours has a small panel title and "Tell us a little about yourself and your business."
2. [fix] local: City, State and ZIP are a full-width row under Business Name and Address in the mockup; ours puts them under the Business Address half only (`looks.ts:663`).
3. [decide] local: the mockup card is "Georgia Registered Agent / Act as your official registered agent in Georgia."; ours is "Registered Agent in Our State / We act as your official registered agent in our state." Ours suits every firm; the firm's state is not in `PortalInfo` ([contract/API] if wanted).

### Business Development 2: `Development intake 2 .png` (sheets `development-intake-2*.jpg`)
Shared: S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, S11, S12, S14, S18. Local:
1. [decide] local: Business Overview has "What is your business name?*" as an input plus "Do you already have a business name in mind?" in the mockup; ours has only the Yes/No, with the name hidden until Yes. NOTES §8 calls the pair redundant.

### Business Development 3: `Development intake 3.png` (sheets `development-intake-3*.jpg`)
Shared: S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, S11, S12, S14, S18, S23. Local:
1. [decide] local: Additional Details asks "How did you hear about LVP Accounting & Taxes?*" in the mockup; ours does not (it is asked on step 1; a duplicate per NOTES §8).
2. [contract/API] (copy only) local: the Document Uploads subtitle ends "This is not required." in the mockup; ours omits it. The zone is "Drag and drop files here or click to upload" with "Accepted file types: PDF, DOC, DOCX, JPG, PNG (Max 10MB per file)" and a "Choose Files" button (S23).

### Business Development 4: `Development Intake 4.png` (sheets `development-intake-4*.jpg`)
Shared: S1, S2, S4, S7, S8, S9, S10, S12, S14, S16, S18, S19, S20, S21. Local:
1. [fix] local: "Almost Done!" is an orange script in the mockup; ours is a blue serif (`intake-flow.tsx:108-110`, the hero line).
2. [fix] local: card 2 "Selected Services" is the ticked list only in the mockup; ours adds "How Did You Hear About Us?" and "Additional Notes" (`looks.ts:775`).
3. [fix] local: the separate "Uploaded Documents (Optional)" card (file name and size) is missing; ours has a "Document Uploads (Optional): N/A" row in card 4.
4. [fix] local: the submit button reads "Submit Form" in the mockup and "Submit Intake Form" in ours (`intake-flow.tsx:292`).
- Not counted (see S19): the mockup's agreement is inline, 7 clauses in two columns, with "View/Download Service Agreement".

### Success, Tax Prep: `Success Tax Prep.png` (sheets `success-tax-prep*.jpg`)
Shared: S2, S4, S7, S8, S9, S10. Local (`begin/done/_components/done-screen.tsx`, **local**):
1. [fix] The check circle is about 165 px at 1440 with five orange sun rays in the mockup; ours is 96 px with no rays (:53-58).
2. [fix] "Success!" is about 118 px navy in the mockup; ours 60 px `#005fcc` (:59).
3. [fix] The orange rule sits under "Your Form Has Been Successfully Submitted!" on the Tax mockup; ours is under "Success!" on both variants (:60).
4. [fix] The intro is 3 centred lines at about 21 px in the mockup; ours is 15 px (:64-76).
5. [fix] What Happens Next.
   - Mockup: a card about 1130 px wide, a white disc of about 160 px with a people icon, a vertical divider, a 30 px title, and solid orange check discs.
   - Ours: `max-w-4xl` (896 px), a 96 px disc, no divider, outline `CircleCheck` icons (:79-113).
6. [fix] The three tiles stand on white with vertical dividers in the mockup, and "We appreciate your trust in LVP Accounting & Taxes." is blue. Ours puts them in a light-blue box with no dividers (:154-170).
7. [decide] The first tile says "You'll receive a confirmation email with a copy of your submission." in the mockup; ours drops "with a copy of your submission" (:159). CLAUDE.md hard rule 4 is "No passwords, tokens, SSNs, bank numbers or document content in logs, emails or SMS", so a copy of an Annual submission (SSNs) cannot go by email. Keep ours.
8. [decide] Ours adds "Schedule an Appointment" and "Back to Begin Online"; the mockup has neither (:172-184; R22 step 7 added them).
9. [contract/API] (S10) The photo background and "Your Goals. Our Expertise. A Brighter Tomorrow." with "PLAN | PREPARE | PROSPER" were removed on purpose in #287.

### Success, other services: `Success Page for all services except taxes.png` (sheets `success-page-for-all-services-except-taxes*.jpg`)
Shared: S2, S4, S7, S8, S9, S10. Local (`done-screen.tsx`, **local**):
1. [fix] The check circle size and rays, and the "Success!" size, are as in the Tax variant (:53-59). The orange rule is under "Success!" in both, but about 270 px wide in the mockup and 160 px in ours (:60).
2. [fix] "What Happens Next?" has orange rules on both sides in the mockup; ours has none (:116).
3. [fix] The steps card has "›" chevrons in light discs between the steps and vertical dividers in the mockup. Its icons are larger: a document with a magnifier, a phone with orange signal waves, and a people group. Ours has none of the chevrons or dividers and 40 px outline icons (:119-150).
4. [fix] Tile 2's icon is a clock in the mockup and a phone in ours (:162).
5. [fix] Tile 3 reads "We appreciate the opportunity to serve you and be part of your journey." in the mockup and "We appreciate your trust in {firm}." in ours (:168).
6. [decide] Tile 1 drops "with a copy of your submission" (as on the Tax variant, item 7).
7. [decide] Ours adds "Schedule an Appointment" and "Back to Begin Online" (as on the Tax variant, item 8).
8. [fix] The content width is `max-w-4xl` (896 px) in ours; the mockup's card is about 1130 px at 1440.

---

## Empty and API-unreachable states

Shots: `shots/state-*.png`, `shots/start-*.png`.

### Empty
- **Empty `/lvp/begin`:** the page has no data-driven widgets. The cards come from `BEGIN_ONLINE_SERVICES` in the contract, so the empty page is the same as `begin-online.png`. Fine.
- **Empty form, before the steps:** a browser with no draft opens on a **"Let's get started" start card** (first name, last name, email, phone, "Start My Form") under the form title and an all-grey stepper (`intake-flow.tsx:329-473`). **No mockup has this screen.**
  - [decide]: it exists because the API keys a draft to a name and email (a lead) before any step can be saved. The mockups start straight on step 1.
  - Its stars are red. The intake fields' stars are blue (S5).
  - See `shots/start-annual.png` and the other `start-*.png`.
- **Empty step 1 after starting:** the mockups draw empty fields with placeholders, and our step 1 matches that, except that name, email and phone come prefilled from the start card (the phone as E.164, S13).
- **Real-API empty state of five forms locally:** "Quarterly Tax intake / About you / Documents / Review and submit" (`shots/state-quarterly-empty-real-api.png`). This is the seed stand-in described at the top.

### API unreachable
1. **Before the first load (any Begin Online URL):** the whole page is one card, "We can't reach Firmivra. Check your connection and try again." with "Try again". There is no header, no footer, and none of the static Begin Online content, even though `/lvp/begin` needs no data (`shots/state-begin-unreachable-before-load.png`, `state-annual-unreachable-before-load.png`).
   - Cause: `apps/web/src/app/portal/[firmSlug]/layout.tsx:27-38` wraps every portal page in `PageState` on the firm-info query.
   - This breaks design-match rule 2 ("one error panel never replaces a page").
   - The file belongs to R17/R1, not to Begin Online.
   - **Not handled well.**
2. **After the first load (Begin, then a service card):** the header and footer stay. The form area becomes one error card with "Try again" (`state-annual-unreachable-after-load.png`).
   - The form's title, lock bar and stepper are not drawn, because `IntakePage` puts everything inside `PageState` (`intake-flow.tsx:221-229`), so the frame is lost.
   - The text names "Firmivra" (`apps/web/src/lib/errors.ts:41`). A visitor of LVP's public page has never heard that name.
   - **Partly handled:** there is a retry, but the frame goes and the brand is wrong.
3. **While a form is open (start card, then Start My Form):** the inline red line "We can't reach Firmivra. Check your connection and try again." appears under the fields, and the form stays (`state-start-unreachable-on-submit.png`).
   - Handled, apart from the wording.
   - The same inline pattern covers Continue, Save Later and Submit (`intake-flow.tsx:876-880`).

---

## "Schedule an Appointment" count (R56's note on `r22-begin-online`)

**3 is right.** `Begin online.png` has three: the header button, the hero CTA and the "Ready to Get Started?" band.

The spec at `apps/web/e2e/mock/r22-begin-online.spec.ts:28` expects 2 at a 1024 px viewport. It was written in #287 (Oct 10), before the LVP header gained its own "Schedule an Appointment" in #457 (FIR-445, `(public)/layout.tsx:202-210`).

Measured with the spec's locator (`getByRole('link', { name: 'Schedule an Appointment' })`):

| Width | Count | Where |
| --- | --: | --- |
| 375 | 2 | hero, Ready band |
| 1023 | 2 | hero, Ready band |
| 1024 | 3 | header, hero, Ready band |
| 1440 | 3 | header, hero, Ready band |

The `lg` nav shows from 1024 px; below that the header link is inside the closed mobile menu.

Fix the spec to `toHaveCount(3)` at 1024, or scope it to `main` and expect 2.

---

## Lists by tag

### [R56] (`_blocks/form-blocks.tsx`, `_blocks/intake-grid.tsx`, control rules in `_blocks/intake-scale.module.css`)
- S3: control height 44 px against about 35 px; the 44 px min-height on choice rows (`intake-scale.module.css:46-57, 83-87, 129-132`).
- S6: input border, radius and placeholder colour; label weight; native date and month look (`intake-scale.module.css:55, 64-67`).
- S14: stepper circle size, label size, completed check (`form-blocks.tsx:320-367`).
- S16: Edit buttons (`form-blocks.tsx:387-395`).
- S17: "Not provided" against "N/A" (`form-blocks.tsx:417`).
- Grid currency cells: a separate "$" and a "0.00" placeholder (`intake-grid.tsx:172`); row heights.
- Grid first column too narrow, so labels wrap (`intake-grid.tsx:72`); the "Quarter / Amount" header the mockup lacks.
- Q2 tint `warning-soft` `#fff0c2` against peach `#fef3e6` (`intake-grid.tsx:37`).
- Per-column total colours (`intake-grid.tsx:202-205`).
- Section badge 44 px against about 62 px, and panel title sizes (`form-blocks.tsx:69-94`), together with S2.

### [contract/API]
- Firm marketing content (S10): taglines and mottos, banner scripts, hero and success photos per firm. `PortalInfo` (`packages/types/src/client-auth/schemas.ts:42-72`) has only `sidebarSlogan`, `sidebarMotto`, `header` and `welcomeMessage`; images need an upload route.
- Firm contact details for the footer (S9): phone, email, website, address, social links. Not in `PortalInfo`; LVP's are hard-coded in `portal-footer.tsx`.
- Signature (S19): a drawn signature image, and "Email (for confirmation)" (Tax Planning, Business Development), in `IntakeSignatureInput`.
- Uploads (Quarterly 4): a `quarter` tag (and a visitor-chosen document type) on `IntakeUpload` and `CreateIntakeUploadRequest` (`packages/types/src/intake/schemas.ts:110-119`).
- Review-only fields, if kept (S21): Annual Occupation, Type of Work / Income Source, Primary Business Activity, Tax Year; Quarterly Ownership %, Type of Business; Business Development Website, Fiscal Year Start, Bookkeeping Needs.
- Tax Planning: Tax Year as a select of years (TP1.4, TP2.1).
- Business Development: the firm's state for "Registered Agent in {state}" (BD1.3), if wanted.
- Copy only, in `forms/*.ts`:
  - Annual: Income Documents examples in the subtitle; the Wages column header.
  - Quarterly: placeholders; the "best estimate" callout (step 3); the Additional Supporting Documents text; "Tax Type" and "Q1 (Jan – Mar)" grid headers.
  - Bookkeeping: hint placeholders; the review banner subtitle; the step 3 info box text.
  - Payroll: placeholders.
  - Tax Planning: "(If Applicable)" and its skip line; "(Select all that apply)"; the Upcoming Changes subtitle; the review hero line (`forms/tax-planning.ts:477`).
  - Business Development: "This is not required."
- Note: a stored firm form keeps its version. The seed stores `INTAKE_FORMS` into `intake_forms` rows, and the API publishes the built-in form as version 1 on first use (`apps/api/src/begin-online/begin-online.service.ts:204-217`). So copy or field changes to `forms/*.ts` reach an existing firm only through a new published version.

### [decide]

Rasel decided on Oct 21: S3 (35 px on desktop, 44 px on phones), S4, S6 and S27 (keep the
mockup colours), S8 and S9 (each design's own header and footer) and the Success copy
("confirmation", no submission content in the email). See `R60-settings.md` item 5. The other
items below are still open.

- **S3** control and row heights. Mockup about 35 px fields and about 25 px choice rows; the kit's 44 px controls. The project bar is WCAG 2.1 AA ("WCAG 2.1 AA: keyboard navigation, visible focus, 4.5:1 contrast...", `docs/PROJECT-DRAFT-v2.md:269`); 44 px targets are AAA.
- **S6** mockup input border 1.47:1 and placeholder 1.97:1, against WCAG 1.4.11 (3:1) and 1.4.3 (4.5:1).
- **S8** header. The mockups disagree: full nav with Begin Online, nav without it plus a tagline, no nav, and photo heroes. It is R17's layout. The gold header button is 2.42:1.
- **S9** footer. The Begin mockup's white footer, the forms' navy band, and our portal footer.
- **S10** taglines, slogans and firm photos. R22's #287 review removed the firm logo from the hero and the taglines from the Success pages (`docs/work/R22-begin-online.md:41`); the mockups have them.
- **S11** conditional follow-ups: hidden (ours) or drawn (mockups).
- **S15** step labels: the mockups word the same step 2-3 ways (NOTES §9).
- **S18** save-later on steps whose mockup has none; button placement.
- **S19** which acknowledgments are fixed per form; a typed date against the server date; Title/Position where the mockup has none; the Payroll PDF viewer.
- **S21** review fields the forms never collect (NOTES §9: "align review-page fields with what the forms actually collect").
- **S27** white on orange 3.06:1 (the mockups 3.11-3.27:1), against AA 4.5:1 for 15-21 px text.
- Start card: no mockup has it; the draft API requires a name and email first.
- Success copy "with a copy of your submission", against CLAUDE.md hard rule 4: "No passwords, tokens, SSNs, bank numbers or document content in logs, emails or SMS."
- The Success pages' extra "Schedule an Appointment" and "Back to Begin Online" (R22 step 7), not in the mockups.
- Masking: Annual review SSN eye (mockup) against last 4 only (ours); Quarterly EIN shown in full (mockup) against masked (ours); the EIN input eye.
- Annual: spouse fields required when married (ours) against no stars (mockup).
- Annual 3: the "please explain" box always visible (mockup) against shown on tick (ours). The Business documents slot is required with "I don't have this document" (ours) against an optional zone with a starred note (mockup).
- Bookkeeping 2: Yes/No as text inputs (mockup) against radios (ours; NOTES says radios).
- Bookkeeping 3: "I don't have this document" on required slots (ours) against "skip it for now" (mockup). Accepted formats (ours add Excel and Word).
- Duplicates the mockups ask twice (NOTES): Quarterly quarters and tax year on step 2; Payroll start date and current provider on step 1; Business Development "business name" input and "How did you hear" on step 3; Tax Planning "Tax year of most recent return" in Personal Income.
- Quarterly 1: our extra "Your Full Name".
- Business Development 1: "Georgia Registered Agent" (mockup) against a firm-neutral label (ours).
- Tax Planning 1, Business Development 2: tick boxes for single-choice questions (mockup) against radios (ours).
- The local seed has five stand-in forms (see the top): decide whether `pnpm db:seed` should seed the real forms (`realForms`) so local and dev show what the mockups show.

### Checked and the same (not differences)
- The order and copy of the six Begin services.
- Every form's step count and step order.
- Panel and section order and titles on every step, apart from the items above.
- The field order inside the panels.
- The Bookkeeping package names and features.
- The Business Development service list (12).
- The Tax Planning goal, change and concern lists.
- The Quarterly expense categories and hints.
- The Annual payment options' text.
- The Success pages' main copy, apart from the items above.
- The resume page has no mockup and was not compared.
