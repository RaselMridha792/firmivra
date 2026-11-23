# Super Admin Reports: metric definitions

This file defines the figures shown by `/admin/reports`. The API contract is in `packages/types/src/admin-reports/schemas.ts`; calculations are in `apps/api/src/admin-reports/`.

| Metric | Definition | Source |
| --- | --- | --- |
| Total firms | Firms created by the end of the selected period | Platform firm records |
| Active firms | Firms whose platform status is Active | Platform firm records |
| MRR | Monthly equivalent of subscriptions counted as Active or Non-Renewing; annual prices are divided by 12. It uses the subscription's current billed amount, including a negotiated override or discount. | Subscription records and daily MRR snapshots |
| Collected revenue | Successful payments received in the period, less refunds | Billing payments and refunds |
| New users | Staff and client logins created in the period | Platform signup rollup |
| Active users | Users active on the latest rollup day at or before the period end | Daily firm metrics rollup |
| Feature usage | Events and active firms recorded for each feature in the selected period | Daily feature usage rollup |
| Support response time | Average minutes from ticket opening to first response for tickets answered in the period | Support tickets |
| Support resolution time | Average elapsed hours from ticket opening to resolution for tickets resolved in the period; SLA pauses are excluded | Support tickets |

A missing source is `null` or an empty result, never a fabricated zero. Trend comparisons use the immediately preceding period of equal length. The builder's `search` filter uses the same firm search field as the Firms report.
