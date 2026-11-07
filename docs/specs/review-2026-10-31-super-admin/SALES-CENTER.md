# Super Admin review (Oct 31): Sales Center change list

Source: "Sales Center Developer Feedback" (Oct 31, 2026, 13:02 to 13:07 UTC, `/sales`, empty sales data). Her codes are kept (SC 01 becomes SC01). Rows she did not number are ours (SA-SAL-F01, SA-SAL-Y01 ...).

Plan facts come from the Super Admin Plan Tier Developer Guide, revised edition for website v72 (Nov 1, 2026), which replaces the plan names and prices her review checked against. Only the facts shown on screen are copied here.

## Summary

1. F items: 3 (SC01, SC02, F01). Y items: 5 (SA-SAL-Y01 to Y05). GREEN: 8 rows, not items (displayed prices and capacities, plus 7 interface checks: plan information, action forms, lost reason controls, date controls, activity and follow-ups, overview empty state, Sales navigation). Keep the layout and those behaviors; the prices themselves change under F01.
2. Highest priority: correct plan content. Her SC01 (empty "Best fit" cells) and SC02 (Enterprise starting price) now apply to the v72 catalog: new names, new prices, new summaries (F01).
3. Keep the Sales Center layout exactly (cards, detail dialogs, comparison, section order). Only the content changes.
4. Sales Center is a platform-owner tool. No customer plan includes it, and buying a plan never grants Super Admin access.
5. Schema: none. Plans live in `packages/db/src/platform-plans.ts` (seeded by `seed-platform-plans.ts` into `platform_plans`); existing dev subscriptions on the old plans: Y05.
6. Out of scope here: the full 70-row feature comparison, catalog versioning and entitlement enforcement from the v72 guide. They go with the later pricing pass.

Code map (folders only, verify before use). Web: `apps/web/src/app/admin/(console)/sales/`. API: `apps/api/src/admin-sales/`. Plans: `packages/db/src/platform-plans.ts`, `PlatformPlan` (`code`, `name`, `base_price_cents`, `included_seats`, `max_seats`, `overage_price_cents_per_seat`, `included_locations`, `overage_price_cents_per_location`, `display_order`).

## v72 plan facts shown on screen

Fixed order and exact spelling. Annual = monthly base x 12 x 0.85, on the base only (never on extra seats or add-ons); show the annual total and the monthly equivalent as two separate values.

| Plan | Monthly base | Annual total | Monthly equivalent | Users | Extra users | Summary (replaces "Best fit") |
| --- | --- | --- | --- | --- | --- | --- |
| SoloFirm | $59 | $601.80 | $50.15 | 1 | Not available | For one professional |
| SoloFirm Pro | $89 | $907.80 | $75.65 | 1 | Not available | For an advanced solo practice |
| DuoFirm | $149 | $1,519.80 | $126.65 | 2 | Not available | For two people |
| TeamFirm | $199 | $2,029.80 | $169.15 | Up to 5 included | $39 per user per month | For a collaborative team |
| GrowFirm | $499 | $5,089.80 | $424.15 | Up to 15 included | $35 per user per month | Business-level firm management |
| ScaleFirm | From $799 | From $8,149.80 | From $679.15 | 20 included | Contact Sales | Multi-firm management |

Package colors: use the hex values in the v72 guide, section "Names colors and summaries", for accents and badges only, always with the name in text.

## A. F items

| ID | Report | Screen | Observed | Build or fix | Schema? | Seed / role / shared |
| --- | --- | --- | --- | --- | --- | --- |
| SA-SAL-SC01 | SC 01 | Compare All Packages > "Best fit" column | Every Best fit cell is blank. | Fill the column for all six plans with the v72 summary text in the table above (her Oct 31 wording describes the retired plans). Check it is present and readable on screen for every plan, including phone width. | No (catalog content). | None. |
| SA-SAL-SC02 | SC 02 | Top plan card, detail dialog, comparison | $799/month shown with no "From". | Show "From $799/month" and "Contact Sales" for ScaleFirm in all three places. Under v72, drop the old three-location allowance and the $149 per extra location fee; extra users above 20 are Contact Sales, never a guessed rate. | No. | None. |
| SA-SAL-F01 | v72 guide, "Required display changes" (not in her report) | Plan cards, detail dialogs, comparison, plan selectors on Sales forms | Old names (Solo Core, Solo Pro, Solo Elite, Team Pro, Business, Enterprise) and old prices ($69, $99, $149, $199, $499, from $799). | Replace the plan catalog with the six v72 plans in the table above: names, order, monthly base, annual total, monthly equivalent, included users, extra-user terms, summaries. Bind the existing Sales Center components to the catalog (no second hand-written table). Same names on the Start Trial, Add Lead and Create Offer selectors. Before and after screenshots show the layout unchanged. | No (plan rows are data). | Seed: plans reseeded in dev (Y05). |

## B. Y items

| ID | Report | Item | What we supply and default |
| --- | --- | --- | --- |
| SA-SAL-Y01 | "Developer review of overview KPI clicks"; "KPI navigation" | Six KPI tiles and stage summaries are inert | Default: make them drill-downs. Total Leads, Demos Scheduled, Active Trials, Won Deals and Lost Deals open `/sales/pipeline` in List view filtered to the matching records and the current period; Projected MRR opens the open opportunities sorted by value; each stage count opens the pipeline filtered to that stage. With zero records they open the filtered empty state. Same clickable-tile component as the Dashboard. |
| SA-SAL-Y02 | "Trial eligibility" | Start 14 Day Trial excludes the top plan | Default: keep ScaleFirm out of self-start trials (it is Contact Sales); show "ScaleFirm: contact sales" in the plan list instead of hiding it. |
| SA-SAL-Y03 | "Source scope" | Pipeline guide vs the `/sales` overview | Default: `/sales` keeps its own overview; the Pipeline KPI and final-stage rules apply to `/sales/pipeline` only. |
| SA-SAL-Y04 | "Waiting for dummy sales data" | Analytics, lead validation, assignment and demo, proposal and trial, activity and follow-ups, pricing totals, export and permissions | Dummy data set J in CHANGE-LIST.md (dated leads in every state, activity, follow-ups, selectable firms). Test each pending check against it; no real delivery or trial activation. Pricing totals: seat totals for TeamFirm and GrowFirm only (the first three plans cannot add seats). |
| SA-SAL-Y05 | v72 guide, "Audit every downstream Super Admin reference" | Existing dev subscriptions and sales records on the old plans | Default: in dev, mark the six old plans inactive (kept for history, never renamed in place), add the six v72 plans, and reseed the dummy subscriptions and sales records onto the new plans. No automatic old-to-new mapping (similar prices are not equivalent plans). Production migration of real subscriptions belongs to the later pricing pass. |

## C. Schema needs

None. Plan names and prices are catalog data.

## D. Role and permission notes

No role change. Sales Center stays a Super Admin tool; customer plans never include it.
