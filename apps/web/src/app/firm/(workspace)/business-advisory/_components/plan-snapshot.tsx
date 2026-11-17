'use client';

import type { AdvisoryVersionDetail } from '@firmivra/types';
import type { ReactNode } from 'react';
import { AREA_LABEL, GOAL_STATUS, REC_STATUS, SOURCE, dayText, money } from './ba-shared';

const WORKSTREAM_STATUS: Record<string, string> = {
  INTERESTED: 'Interested',
  PROPOSED: 'Proposed',
  ACCEPTED: 'Accepted',
  IN_PROGRESS: 'In Progress',
  AWAITING_CLIENT: 'Awaiting Client',
  COMPLETED: 'Completed',
  DECLINED: 'Declined',
  ON_HOLD: 'On Hold',
};

const list = (items: readonly string[] | undefined) => (items ?? []).join(', ');
const join = (parts: (string | null | undefined)[], by = ' · ') => parts.filter(Boolean).join(by);

/** One part of the snapshot: its title and its fields, each "—" when the plan had none. */
function Part({
  title,
  rows,
  children,
}: {
  title: string;
  rows?: [string, string | null | undefined][];
  children?: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2 border-t border-divider pt-3">
      <h4 className="font-semibold text-heading">{title}</h4>
      {rows ? (
        <dl className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-x-3 gap-y-1">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="min-w-0 wrap-anywhere whitespace-pre-wrap text-heading">{v || '—'}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {children}
    </section>
  );
}

/**
 * Advisory Review 2 A-07 (Octavia's B9): a finalized version as it was, whole and read only: the
 * business profile, the assessment, goals and strategy, recommendations, services and the figures
 * it used (when the member may see financials), from the version's stored content. Nothing here
 * can be edited; a change to the plan makes a new version.
 */
export function PlanSnapshot({ version: v }: { version: AdvisoryVersionDetail }) {
  const p = v.profile;
  const a = v.assessment;
  const s = v.strategy;
  return (
    <div className="flex flex-col gap-3" data-testid="plan-snapshot-full">
      <Part
        title="Business Profile"
        rows={[
          ['Business', p.businessName],
          ['Entity / industry', join([p.entityType, p.industry])],
          [
            'Years / stage',
            join([p.yearsInBusiness == null ? '' : `${p.yearsInBusiness} years`, p.businessStage]),
          ],
          ['Products & services', p.productsServices],
          [
            'Address',
            join(
              [
                p.address?.line1,
                p.address?.line2,
                p.address?.city,
                p.address?.state,
                p.address?.postalCode,
              ],
              ', ',
            ),
          ],
          [
            'Contact',
            join([p.primaryContact?.name, p.primaryContact?.email, p.primaryContact?.phone]),
          ],
          ['Website', p.website],
          ['Employees', p.employeeCount == null ? '' : String(p.employeeCount)],
          ['Hiring plans', p.hiringPlans],
          [
            'Key team members',
            (p.keyTeamMembers ?? []).map((m) => join([m.name, m.role], ', ')).join('; '),
          ],
          ['Found us through', p.referralSource],
          ['Notes', p.notes],
        ]}
      />
      <Part
        title="Financial & Business Assessment"
        rows={[
          ['Figures as of', v.sourceDataAsOf ? dayText(v.sourceDataAsOf) : ''],
          ['Data source', a.dataSource ? (SOURCE[a.dataSource] ?? a.dataSource) : ''],
          [
            'Funding needed',
            a.funding?.amountNeededCents == null ? '' : money(a.funding.amountNeededCents),
          ],
          ['Funding purpose', a.funding?.purpose],
          ['Funding timing', a.funding?.timing],
          ['Funding readiness', a.funding?.readiness],
          ['Current customers', a.sales?.customers],
          ['Sales trend', a.sales?.salesTrend],
          ['Target market', a.sales?.targetMarket],
          ['Competitors', a.sales?.competitors],
          ['Differentiation', a.sales?.differentiation],
          ['How the business operates', a.operations?.howItOperates],
          ['Systems challenges', a.operations?.systemsChallenges],
          ['Staffing', a.operations?.staffing],
          ['Efficiency opportunities', a.operations?.efficiencyOpportunities],
          ['Strengths', list(a.strengths)],
          ['Weaknesses', list(a.challenges)],
          ['Opportunities', list(a.opportunities)],
          ['Threats', list(a.threats)],
        ]}
      />
      <Part
        title="Goals & Strategy"
        rows={[
          ['Strategy summary', s.summary],
          [
            'Focus areas',
            s.noFocusArea
              ? 'None / Not Applicable'
              : (s.areas ?? [])
                  .map((x) =>
                    join([`${AREA_LABEL[x.area] ?? x.area}: ${x.objective}`, x.notes], ' — '),
                  )
                  .join('\n'),
          ],
        ]}
      >
        {v.goals.length ? (
          <ul className="flex flex-col gap-1" aria-label="Goals">
            {v.goals.map((g, i) => (
              <li key={`${g.title}-${i}`} className="text-heading">
                {g.title}
                <span className="text-muted">
                  {' '}
                  ·{' '}
                  {join([
                    GOAL_STATUS[g.status] ?? g.status,
                    g.area ? (AREA_LABEL[g.area] ?? g.area) : '',
                    g.targetDate ? `target ${dayText(g.targetDate)}` : '',
                  ])}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">No goals.</p>
        )}
      </Part>
      <Part title="Recommendations">
        {v.recommendations.length ? (
          <ul className="flex flex-col gap-2" aria-label="Recommendations">
            {v.recommendations.map((r, i) => (
              <li key={`${r.title}-${i}`}>
                <span className="text-heading">{r.title}</span>
                <span className="text-muted">
                  {' '}
                  · {join([REC_STATUS[r.status] ?? r.status, r.impactLabel])}
                </span>
                {r.rationale ? (
                  <span className="block whitespace-pre-wrap text-text">{r.rationale}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">No recommendations.</p>
        )}
      </Part>
      <Part title="Services">
        {v.workstreams.length ? (
          <ul className="flex flex-col gap-1" aria-label="Services">
            {v.workstreams.map((w, i) => (
              <li key={`${w.serviceName}-${i}`} className="text-heading">
                {w.serviceName}
                <span className="text-muted">
                  {' '}
                  · {w.role === 'PRIMARY' ? 'Primary' : 'Additional'} ·{' '}
                  {WORKSTREAM_STATUS[w.status] ?? w.status}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">No services.</p>
        )}
      </Part>
      {v.financials ? (
        <Part title="Financial Figures Used">
          {v.financials.length ? (
            <ul className="flex flex-col gap-1" aria-label="Financial figures">
              {v.financials.map((f) => (
                <li key={f.id} className="text-heading">
                  {dayText(f.periodStart)} – {dayText(f.periodEnd)}
                  <span className="text-muted">
                    {' '}
                    ·{' '}
                    {join([
                      f.revenueCents == null ? '' : `Revenue ${money(f.revenueCents)}`,
                      f.expensesCents == null ? '' : `Expenses ${money(f.expensesCents)}`,
                      f.netProfitCents == null ? '' : `Net profit ${money(f.netProfitCents)}`,
                      SOURCE[f.source] ?? f.source,
                    ])}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">No figures.</p>
          )}
        </Part>
      ) : null}
      <p className="border-t border-divider pt-3 text-xs text-muted">{v.disclaimer}</p>
    </div>
  );
}
