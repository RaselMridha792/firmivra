# Design tokens — FIR-S0-F1

Status: implemented baseline, 7 October 2026; visual approval pending. The original S0-F1 is now F01 in [Fahad's updated ticket plan](../tasks/FAHAD.md). Sources: [repo instructions](../../CLAUDE.md) and all **50 supplied PNGs** in `docs/mockups/` (26 Begin Online, 18 client portal, 5 Super Admin and the Firmivra logo). See the [complete inventory](mockup-inventory.md).

The screenshots establish colour families, hierarchy and component treatments. They are raster references with gradients, antialiasing and inconsistent accents, not source design files. The HEX values below are normalized implementation choices informed by visual inspection and pixel sampling, not verified original brand values. Font families, exact type sizes, spacing, radii, shadows and breakpoints are proposed; confirm them during Octavia's visual review. Screenshot pixel dimensions are not CSS viewport widths.

Implementation: [TypeScript tokens](../../packages/ui/src/tokens.ts), generated [Tailwind v4 CSS theme](../../packages/ui/src/tokens.css), shared components and the Storybook Foundation gallery in `packages/ui`. Regenerate CSS with `pnpm --filter @firmivra/ui tokens`. Firmivra, LVP portal and LVP Begin Online have separate semantic theme mappings. Review notes and captured screens are in [review/README.md](review/README.md).

## 1. Theme boundaries

- **Firmivra:** Super Admin and firm workspace always use the platform navy/blue/teal palette. There are no firm workspace mockups; derive its style from Super Admin.
- **Firm brand layer:** client portal, client account flows and Begin Online resolve a tenant theme. LVP (`lvp`) is the initial preset: navy, gold and orange, with blue portal actions.
- **Shared meaning:** neutral surfaces, text, folders, status colours and Business Action Items stay semantic. A tenant brand override must not turn a STOP warning into a brand accent or change the meaning of paid/pending.
- Components consume semantic roles such as `--color-action` and `--color-navigation`, never a specific tenant or palette name. The theme selects their values.

## 2. Colour

Every colour below includes its intended use. Hover and pressed values apply to interactive controls, not standalone decoration.

### Firmivra platform palette

Reference: `super-admin/Super login.png`, `Dashboard Active .png`, and application/approval screens. Dark navy shell, blue actions and teal highlights are visible; teal is most evident in the login artwork and feature icons.

| Token | HEX | Use |
| --- | --- | --- |
| `firmivra.navy` | `#001B36` | Sidebar, navigation, login panel and platform footer; white foreground. |
| `firmivra.navy-raised` | `#103F63` | Selected/hovered navigation surface over navy; white foreground. |
| `firmivra.blue` | `#005FCC` | Primary buttons, selected controls, links and focus ring. |
| `firmivra.blue-hover` | `#004FA8` | Hovered primary actions and links. |
| `firmivra.blue-pressed` | `#003D85` | Pressed primary actions. |
| `firmivra.teal` | `#007F82` | Platform feature icons and restrained growth/settings accents; not a replacement for success status. |
| `firmivra.teal-soft` | `#E1F5F2` | Background behind teal platform icons or informational highlights. |

#### Reference layout overrides within Firmivra

The normalized palette above belongs to the shared component baseline. The Super Admin composition uses the following `--ref-*` aliases in [mockup.css](../../packages/ui/src/mockup.css), matching its supplied visual reference more closely. These are Firmivra colours, not a third brand. Do not substitute baseline blue/navy for these aliases when comparing the reference layout.

| Alias | HEX | Use in reference screens |
| --- | --- | --- |
| `--ref-ink` | `#001744` | Platform headings, sidebar, dark text and shadow base. |
| login artwork base | `#001226` | Dark background behind the login composition. |
| `--ref-muted` | `#536A91` | Supporting text, table labels and timestamps. |
| `--ref-blue` | `#006AFF` | Primary controls, selected navigation and blue highlights. |
| `--ref-cyan` | `#00D9D1` | Login brand underline and decorative teal emphasis. |
| `--ref-rule` | `#DCE7F4` | Card borders and table separators. |
| `--ref-control-rule` | `#CBDCF2` | Reference form borders; retain visible keyboard focus. |
| `--ref-canvas` | `#F3F8FC` | Screen background around white panels. |
| `--ref-green` | `#008C46` | Approved/active indicators and completion highlights. |
| `--ref-purple` | `#7328EA` | Service/category icons and summary highlights. |
| `--ref-gold` | `#AE7900` | Pending/review indicators and gold summary accents. |
| `--ref-red` | `#FF243E` | Declined/error/destructive indicators. |

Reference typography currently uses Arial/Helvetica body text and Times New Roman serif headings; original font files were not supplied. The reference shell uses a 267px sidebar and 68px header, with the dashboard's 289px sidebar override. Login headings use 38px/1.25 serif; supporting hero text uses 20px/28px. The login card has 24px corners and `0 18px 38px #00174426` elevation; icon tiles use 13px corners. These override the proposed generic layout/radius/shadow values later in this document only inside the reference compositions. Native-size and 375px captures are linked in the visual review; mobile breakpoints are adaptations, not measured source specifications.

### LVP firm brand palette

Reference: gold on portal landing/sign-up; orange on Begin Online headers, step markers and submission buttons; navy throughout the portal sidebar and public footer. Several portal screens use blue rather than gold primary controls. Preserve this distinction with surface roles, not a global gold replacement.

| Token | HEX | Use |
| --- | --- | --- |
| `lvp.navy` | `#001B44` | LVP navigation, public footer, intake section bars and serif headings. |
| `lvp.navy-raised` | `#073968` | Hovered navigation and the lighter endpoint of navy shell decoration. |
| `lvp.gold` | `#C58A16` | Public portal sign-in/create-account CTA, brand underline and gold accents; navy foreground. |
| `lvp.gold-hover` | `#BE8313` | Hover on gold CTA; retain navy foreground. |
| `lvp.gold-pressed` | `#B57E12` | Pressed gold CTA; retain navy foreground. |
| `lvp.gold-soft` | `#FFF3DC` | Public security/benefit panels and gold icon halos; not Business Action Items. |
| `lvp.orange` | `#FF6B00` | Begin Online heading emphasis, active step markers and decorative icons; navy text on filled markers. |
| `lvp.orange-action` | `#B94700` | Accessible solid Begin Online submit/continue CTA with white text; darker than the bright screenshot orange. |
| `lvp.orange-hover` | `#9F3D00` | Hovered intake CTA with white text. |
| `lvp.orange-pressed` | `#843200` | Pressed intake CTA with white text. |
| `lvp.orange-soft` | `#FFF0E5` | Intake help/optional-document panels behind navy or charcoal text. |
| `lvp.portal-blue` | `#005FCC` | Authenticated portal actions, links, selected sidebar items and verification buttons; white on filled actions. |
| `lvp.portal-blue-hover` | `#004FA8` | Hovered portal blue actions/links. |
| `lvp.portal-blue-pressed` | `#003D85` | Pressed portal blue actions. |

### Shared neutral and folder palette

Reference: portal folder tabs, tables, cards, account fields, application lists and modal backdrop. Light blue signifies folders and neutral/information surfaces, not a completion state.

| Token | HEX | Use |
| --- | --- | --- |
| `neutral.white` | `#FFFFFF` | Cards, inputs, active folder tab, modal and foreground on dark actions/navigation. |
| `neutral.canvas` | `#F3F8FC` | Page background separating white cards. |
| `neutral.surface-subtle` | `#F8FAFC` | Alternating table rows, read-only panels and inset sections. |
| `neutral.charcoal` | `#273444` | Body copy, labels and neutral table text. |
| `neutral.text-muted` | `#52647A` | Supporting copy, timestamps, captions and placeholders. |
| `neutral.border` | `#D6E3EF` | Decorative card/table dividers; not the sole visible boundary of an input. |
| `neutral.control-border` | `#7B8FA6` | Input, checkbox and outline control boundaries on white/light surfaces. |
| `neutral.disabled-bg` | `#E5EAF0` | Disabled button/input background. |
| `neutral.disabled-fg` | `#52647A` | Disabled text/icons; also show disabled interaction semantics. |
| `folder.surface` | `#E7F3FF` | Inactive folder tabs, neutral blue cards and table headers. |
| `folder.hover` | `#D8EBFF` | Hovered inactive folder tab and neutral row highlight. |
| `folder.border` | `#B9D7F4` | Folder edges and subtle blue card borders. |

### Shared semantic palette

Colour meanings follow S0-F1 even where decorative mockup accents vary. Each status has a text label/icon as well as colour.

| Token | HEX | Use |
| --- | --- | --- |
| `status.success` | `#157347` | Done, completed, approved, active and paid labels/icons. |
| `status.success-soft` | `#DCF4E5` | Background of success pills and confirmation notices. |
| `status.warning` | `#8A5700` | Awaiting review, pending, payment due and due-soon labels/icons. |
| `status.warning-soft` | `#FFF0C2` | Background of awaiting/due-soon pills; not a generic card colour. |
| `status.danger` | `#C9142D` | Blocking errors, STOP, destructive action and overdue blockers requiring intervention. Never use for an ordinary pending item. |
| `status.danger-soft` | `#FDE8EC` | STOP upload panel, blocking validation notice and destructive confirmation panel. |
| `status.info` | `#005FCC` | New, available, in-progress and informational labels/icons; label distinguishes the actual state. |
| `status.info-soft` | `#E7F3FF` | Background for information notices and in-progress/new pills. |
| `business.action-items-bg` | `#FFF8D6` | **Only Business Action Items** card background; do not spread soft yellow to other cards. |
| `business.action-items-border` | `#E5CC72` | Border/divider within Business Action Items. |
| `business.action-items-text` | `#273444` | Action-item description; due date separately uses warning or blocking danger semantics. |

Overlay: `overlay.scrim = rgba(0, 27, 54, 0.55)` (base HEX `#001B36`, 55% opacity), used behind dialogs such as `Upload docs popup.png`. It is not a surface or text colour.

Purple/pink metric icons, file-type icons, photography, logo artwork and script slogans visible in some mockups are illustration assets, not additional semantic UI colours. Preserve original logo assets; do not recolour them through theme tokens.

### Semantic role mapping and overrides

| Component role / CSS variable | Firmivra | LVP portal/account | LVP Begin Online |
| --- | --- | --- | --- |
| `--color-navigation` | `firmivra.navy` | `lvp.navy` | `lvp.navy` |
| `--color-navigation-hover` | `firmivra.navy-raised` | `lvp.navy-raised` | `lvp.navy-raised` |
| `--color-heading` | `firmivra.navy` | `lvp.navy` | `lvp.navy` |
| `--color-action` | `firmivra.blue` | `lvp.portal-blue` | `lvp.orange-action` |
| `--color-action-hover` | `firmivra.blue-hover` | `lvp.portal-blue-hover` | `lvp.orange-hover` |
| `--color-action-pressed` | `firmivra.blue-pressed` | `lvp.portal-blue-pressed` | `lvp.orange-pressed` |
| `--color-on-action` | `neutral.white` | `neutral.white` | `neutral.white` |
| `--color-link`, `--color-focus` | `firmivra.blue` | `lvp.portal-blue` | `lvp.portal-blue` |
| `--color-brand-accent` | `firmivra.teal` | `lvp.gold` | `lvp.orange` |
| `--color-brand-accent-soft` | `firmivra.teal-soft` | `lvp.gold-soft` | `lvp.orange-soft` |
| `--color-public-action` | `firmivra.blue` | `lvp.gold` | `lvp.orange-action` |
| `--color-on-public-action` | `neutral.white` | `lvp.navy` | `neutral.white` |

Public gold actions also resolve public hover/pressed roles to `lvp.gold-hover`/`lvp.gold-pressed`. All themes share `--color-text`, `--color-text-muted`, `--color-canvas`, `--color-surface`, `--color-border`, folder and status roles from the shared tables.

Scope the tenant preset to the portal/public theme root, for example `[data-brand="lvp"][data-surface="portal"]` or `[data-brand="lvp"][data-surface="begin-online"]`. Never apply it to a global root shared by platform screens. A second firm changes role values on its theme root; buttons, cards, tabs and layouts keep the same component code. Derive foreground/hover values with each new brand preset and check contrast before accepting it.

## 3. Typography

The portal/public/intake headings have a high-contrast serif appearance; forms, navigation and tables use sans-serif. The Firmivra dashboard/login lean toward sans-serif, while application screens include serif titles. Font identity is not recoverable reliably from PNGs.

| Token | Proposed family/value | Use |
| --- | --- | --- |
| `font.body` | `Arial, Helvetica, sans-serif` | Body, labels, buttons, tables, sidebar and platform headings. |
| `font.display` | `Georgia, "Times New Roman", serif` | LVP page/section headings; application-page titles where the mockup uses serif. |
| `font.numeric` | Body family + `font-variant-numeric: tabular-nums` | Invoice amounts, dates, metrics and verification codes. |
| `weight.regular` | `400` | Body and help copy. |
| `weight.medium` | `500` | Navigation and short labels; use a real available font weight. |
| `weight.semibold` | `600` | Buttons, labels and table headers; use a real available font weight. |
| `weight.bold` | `700` | Headings and key totals. |

Script slogans and wordmarks remain assets, not an application font. If the selected sans family lacks 500/600, use its real 400/700 weights until the final font is approved; avoid synthetic weights.

Sizes assume a 16px root; use rem for text. Line-height values are unitless.

| Token | px / rem | Line height | Use |
| --- | --- | --- | --- |
| `type.xs` | `12 / 0.75` | `1.5` | Metadata, timestamps, badges and compact captions. |
| `type.sm` | `14 / 0.875` | `1.5` | Table copy, help text, sidebar and field labels. |
| `type.md` | `16 / 1` | `1.5` | Body, input values and primary button labels. |
| `type.lg` | `18 / 1.125` | `1.5` | Lead copy and emphasized body text. |
| `type.xl` | `20 / 1.25` | `1.3` | Card/section headings. |
| `type.2xl` | `24 / 1.5` | `1.25` | Modal titles and major subsection headings. |
| `type.3xl` | `32 / 2` | `1.2` | Desktop portal/workspace page titles. |
| `type.4xl` | `40 / 2.5` | `1.15` | Public account headings and hero titles. |
| `type.5xl` | `48 / 3` | `1.1` | Desktop public hero and success title. |
| `type.6xl` | `64 / 4` | `1.1` | Optional wide-screen success display only. |

Below `md`, page titles use `type.2xl`, hero/success headings use `type.3xl`; above `md` use the role's desktop size. Keep body/inputs at 16px on mobile. Do not reproduce the tiny text created by fitting dense mockups into PNGs. Default letter spacing is `0`; small uppercase brand eyebrow may use `0.12em` with `type.xs`.

## 4. Spacing and layout

Use a 4px base grid, with 2px for fine alignment. These are reusable layout choices inferred from cards/forms rather than exact pixel measurements.

| Token | px / rem | Use |
| --- | --- | --- |
| `space.0` | `0 / 0` | Reset or adjoining folder edges. |
| `space.0-5` | `2 / 0.125` | Small optical correction and tight icon/text offset. |
| `space.1` | `4 / 0.25` | Badge padding and label/help separation. |
| `space.2` | `8 / 0.5` | Icon gap, compact cell padding and grouped controls. |
| `space.3` | `12 / 0.75` | Field internal horizontal padding and compact card padding. |
| `space.4` | `16 / 1` | Mobile page/card padding and field-group gap. |
| `space.5` | `20 / 1.25` | Medium card padding and dense section separation. |
| `space.6` | `24 / 1.5` | Desktop card padding, grid gutter and normal section gap. |
| `space.8` | `32 / 2` | Desktop page padding and major section gap. |
| `space.10` | `40 / 2.5` | Account panel padding on desktop. |
| `space.12` | `48 / 3` | Public section separation. |
| `space.16` | `64 / 4` | Hero/large public section vertical padding. |

Layout aliases: page inset `space.4` on mobile, `space.6` on tablet, `space.8` on desktop; card padding `space.4`/`space.6`; field gap `space.4`; label gap `space.2`; grid gap `space.6`.

Proposed size tokens: `layout.sidebar = 240px`, `layout.header = 64px`, `layout.content-max = 1280px`, `layout.public-max = 1120px`, `layout.auth-max = 480px`, `layout.modal-max = 640px`. Controls: compact height `36px`, default height `44px`, large height `48px`; mobile interactive targets at least `44px`. Compact table cells may be smaller only when their interactive target remains usable.

## 5. Radius

| Token | Value | Use |
| --- | --- | --- |
| `radius.none` | `0` | Table grid edges, shell and footer. |
| `radius.sm` | `4px` | Small buttons, compact badges and table controls. |
| `radius.md` | `6px` | Inputs, standard buttons and small inset cards. |
| `radius.lg` | `8px` | Main cards and folder top corners (`8px 8px 0 0`). |
| `radius.xl` | `12px` | Account panels, upload modal and public benefit cards. |
| `radius.pill` | `9999px` | Status pills, avatars, step markers and circular icon backgrounds. |

## 6. Shadow and focus

Keep tables and embedded cards mostly flat; the strongest elevation belongs to overlays. Shadow base is platform navy (`#001B36`); shadows remain shared across tenant themes.

| Token | CSS value | Use |
| --- | --- | --- |
| `shadow.none` | `none` | Tables, inset panels and folder tabs. |
| `shadow.sm` | `0 1px 3px rgba(0, 27, 54, 0.08)` | Light card separation. |
| `shadow.md` | `0 4px 12px rgba(0, 27, 54, 0.10)` | Account card, dropdown and floating help panel. |
| `shadow.lg` | `0 12px 32px rgba(0, 27, 54, 0.18)` | Modal above scrim. |

Focus: `2px solid var(--color-focus)` with `2px` offset; use a white inner separator on dark navigation so the blue ring remains visible. Do not replace visible keyboard focus with elevation. Shadows do not count as control boundaries.

## 7. Breakpoints

No mobile mockups were supplied. These mobile-first `min-width` breakpoints are proposed around content fit, with 375px verification required by Fahad's tickets.

| Token | Width | Behaviour |
| --- | --- | --- |
| `breakpoint.base` | `0px` | One column, sidebar drawer, stacked account intro/form, scrollable folder tabs and table region. |
| `breakpoint.sm` | `640px` | Two-column short form groups/cards only where content fits. |
| `breakpoint.md` | `768px` | Account intro/form may sit side by side; larger page insets; sidebar stays a drawer. |
| `breakpoint.lg` | `1024px` | Persistent 240px sidebar; main form/dashboard columns. |
| `breakpoint.xl` | `1280px` | Portal main content plus right help/appointment rail when space permits. |
| `breakpoint.2xl` | `1536px` | Centre content within max width; optional largest display heading. |

At narrower widths, move the right rail below the main content, collapse multi-column fields and retain table headers with horizontal scrolling. Breakpoints do not force a column count if labels/content overflow. Verify at 375, 768, 1024 and 1440px and with 200% text zoom. Use literal breakpoint values from the shared export in media queries; ordinary CSS custom properties cannot substitute for media-query widths.

## 8. Export contract and acceptance

For implementation, keep the tables as one source of token values in `packages/ui`:

- TypeScript object: `tokens = { palettes: { firmivra, lvp }, neutral, folder, status, business, typography, spacing, radius, shadow, breakpoint, layout }` and theme role maps such as `themes.firmivra`, `themes.lvp.portal`, `themes.lvp.beginOnline`.
- Generate CSS variables from that source. Example name conversion: `space.4` → `--space-4`, `radius.lg` → `--radius-lg`, semantic `color.action` → `--color-action`. Keep units consistent; do not hand-maintain a second value set.
- Storybook must display every colour with HEX and use, typography samples, spacing bars, radius/shadow examples and breakpoint behaviour. Show the same components in Firmivra, LVP portal, LVP public gold CTA and LVP Begin Online themes.
- Demonstrate changing a second tenant's brand roles without editing component code; platform and status colours retain their defined meaning.
- Check normal text contrast ≥4.5:1, large text ≥3:1 and meaningful control/focus boundaries ≥3:1. Bright gold/orange use navy foreground; white intake button text uses the darker orange-action token. Compare normalized accessible values beside the mockup during review.

Documentation alone does not meet S0-F1's CSS, TypeScript and Storybook acceptance criteria.

## 9. Mockup inspection inventory

All files below were visually reviewed. This inventory preserves the existing filenames, including spaces/typos. Paths are relative to `docs/mockups/`.

### `begin-online/` — 26 images

Annual tax: `Annual Intake Form 1.png`, `Annual Intake Business Income 2 .png`, `Annual Intake From 3.png`, `Annual Tax Intake Form 4.png`.

Public entry: `Begin online.png`.

Bookkeeping: `Bookkeeping intake.png`, `Bookkeeping Background intake.png`, `Bookkeeping Document Upload intake .png`, `Bookkeeping Review  intake.png`.

Quarterly tax: `business Information.png`, `Taxes & Income.png`, `Business Expenses.png`, `Review & Submit.png`.

Development: `Development intake 1.png`, `Development intake 2 .png`, `Development intake 3.png`, `Development Intake 4.png`.

Payroll: `Payroll intake 1.png`, `Payroll intake 2.png`, `Payroll Review intake.png`.

Tax planning: `Tax Planning intake 1.png`, `Tax  planning intake  2 .png`, `Tax Planning intake 3 .png`, `Tax planning intake 4.png`.

Success: `Success Page for all services except taxes.png`, `Success Tax Prep.png`.

### `client-portal/` — 18 images

Public/account: `Client portal landing page.png`, `LVP Client Portal Sign-Up Page.png`, `Verify email .png`, `Verify phone.png`, `LVP Client Portal Account Confirmation.png`.

Authenticated screens: `Business Tab.png`, `Intake form tab.png`, `invoices tab.png`, `Messages and notes.png`, `My docs tab.png`, `My profile.png`, `Taxes tab.png`, `Upload docs popup.png`.

Resources: `Business Startup Guide Dashboard.png`, `External links .png`, `LVP_Tax_Deductions_Small_Businesses.png`, `payroll_resources_dashboard.png`, `Record Keeping Best Practices Dashboard.png`.

### `super-admin/` — 5 images

`Super login.png`, `Dashboard Active .png`, `Firm application.png`, `When firm aplication is open.png`, `Firm approved.png`.
