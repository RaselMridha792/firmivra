# L13: Website lead capture (Octavia's Oct 20 review, item 24)

CHANGE-LIST Oct 21, section C, L13. She asked which ways a firm's website can send leads into Firmivra beyond the large integrated intake form, and for Shopify, GoDaddy, Wix, WordPress and other platforms to be confirmed with test steps, noting that "Shopify presence alone does not confirm capture".

This answer comes from the code on `main` (fd9e48c99) and checks on Oct 24, 2026. The checks were run on the local portal and API with synthetic contacts only, plus one read-only header request to dev.

## Short answer

Today there is **one** way for a website to create a lead: **a link to the firm's Begin Online page** on the client portal. Because it is a plain link, it works from any website builder that can add a link or button: WordPress, Wix, GoDaddy, Shopify or a hand-written site. Nothing about it depends on the platform, so there is nothing platform-specific to confirm.

There is no embedded form, script widget, inbound lead API, inbound webhook, Zapier connection or email-to-lead. The Shopify and HubSpot cards in Integrations don't create leads.

## What exists

| Method | What it does | Status |
| --- | --- | --- |
| **Link to Begin Online** | The visitor opens `https://portal.firmivra.com/{firmSlug}/begin`, which lists the firm's services, or a form directly, for example `/{firmSlug}/begin/annual-tax`. Entering name, email and phone creates the lead for that firm with the form's service, as a draft. When the visitor submits, the lead appears on Leads as **New Lead** with the intake answers. A draft that is never submitted isn't listed, and it expires 30 days after it starts. | Works. Two gaps, below. |
| **Add New Lead, source "Website Form"** | Staff type in a lead that arrived another way, for example from the website's own contact form by email. It's manual. | Works. |

The forms offered for LVP locally: Annual Tax, Bookkeeping, Payroll, Business Development, Quarterly Tax and Tax Planning (`GET /api/v1/portal/lvp/begin/forms`).

## What does not exist

| Method | Finding |
| --- | --- |
| **Embedding the form on the firm's own site** (iframe) | It is blocked. Every site, the portal included, sends `X-Frame-Options: SAMEORIGIN` (CloudFront's managed security headers, `infra/src/stacks/app-stack.ts`). Checked on dev: `curl -I https://portal.dev.firmivra.com/lvp/begin` returns `X-Frame-Options: SAMEORIGIN`, so a browser won't show the form inside another site's page. |
| **A script or widget** to paste into a site | None. |
| **An inbound lead API or webhook** (a site, Zapier or a form service posting a lead) | None. The only public routes that create a lead are Begin Online's. Add New Lead (`POST /business/leads`) needs a signed-in staff member. |
| **Shopify** (Integrations) | It's listed under E-Commerce as "Orders and customer data" for bookkeeping, not lead capture. Its adapter isn't built, so connecting answers `COMING_SOON`. |
| **HubSpot** (Integrations, CRM & Lead Generation) | Contacts sync is listed, but no adapter is built (`COMING_SOON`), and nothing creates leads from it. |
| **Custom webhooks** (Integrations) | Outbound only. Firmivra can send `lead.created` out; it can't receive a lead. |
| **Source or campaign from the link** (for example UTM tags) | Not captured. Every Begin Online lead gets the same source, and no campaign. |

## Gaps found

1. **New Begin Online leads are saved with source "Other", not "Begin Online".**
   - Begin Online creates the lead without a source, so the column default `OTHER` applies.
   - Only the leads that already existed on Oct 14 were set to Begin Online, by migration `r37_lead_fields`.
   - Locally, two drafts started today are `LD-10023` and `LD-10024`, both `DRAFT` and `OTHER`.
   - On Leads, a submitted website lead shows Lead Source "Other", which breaks the attribution she asked for.
   - **Fix:** set `source: 'BEGIN_ONLINE'` when Begin Online creates the lead (`apps/api/src/begin-online/begin-online.service.ts`), with a test. Leads already saved as Other since Oct 14 need a one-off data fix. That's a migration or a script, for Rasel and R0 to decide.
2. **No duplicate handling.**
   - The same email starting again from another browser creates a second lead (`LD-10024` beside `LD-10023`).
   - Add New Lead warns about a duplicate email or phone (409 `POSSIBLE_DUPLICATE`), but Begin Online doesn't check.
   - Whether to merge, link or warn is a product decision.

## Test steps (link to Begin Online)

On dev (`portal.dev.firmivra.com`), using a test firm and fake contact details only:

1. On any page you control (a WordPress, Wix, GoDaddy or Shopify page, or a local `.html` file), add a link: `<a href="https://portal.dev.firmivra.com/lvp/begin/annual-tax">Start your tax return</a>`.
2. Click it in a private window. The Annual Tax start card opens in LVP's branding.
3. Enter a fake name, an `@example.test` email and a 555 phone number, then go through the steps and submit.
4. Sign in as LVP staff and open Leads. The lead is listed as **New Lead** with the Annual Tax service, and its Overview shows the Begin Online request.
   - Lead Source shows **Other** until gap 1 is fixed; it should show **Begin Online**.
5. **Firm check:** sign in to the second test business. The lead isn't there.
6. **Failure reporting:**
   - an unknown firm in the link (`/no-such-firm/begin`) answers 404 Not found;
   - leaving a name out or typing a bad email shows the message next to that field.
7. **Duplicates:** repeat steps 2 and 3 with the same email from another browser. A second lead is created (gap 2).
8. **Embedding (expected to fail):** put `<iframe src="https://portal.dev.firmivra.com/lvp/begin">` on a page from another domain. The browser refuses to show it, because of `X-Frame-Options: SAMEORIGIN`.

## Decisions for Rasel

- **Gap 1:** fix the source on new Begin Online leads (a one-line API change with a test, ready for a PR slot)? And fix the existing ones (data)?
- **Gap 2:** should Begin Online warn about, link or merge a lead whose email already exists?
- **Beyond a link:** if firms need the form *on* their own site, there are two options. One is to allow framing of the Begin Online pages for each firm's own domain, which is an infra header change plus a firm setting. The other is an inbound lead API with a per-firm key. Neither exists today. Both are new work, not fixes.
