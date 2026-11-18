'use client';

import { MY_ADVISORY_PLAN_STATE_LABELS, type MyAdvisoryPlan } from '@firmivra/types';
import { Badge, Card } from '@firmivra/ui';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { useApiQuery } from '../../../../../../../lib/query';
import {
  AREA,
  GOAL_STATUS,
  PLAN_STATE_TONE,
  REC_STATUS,
  SERVICE_STATUS,
  dayText,
} from './advisory-parts';

const row = 'border-t border-divider py-2 first:border-t-0';

/**
 * BA-CP (Client Portal Review One): /{slug}/services/advisory/plans/{id}, one business plan
 * read-only, exactly as the version the firm delivered: its summary and focus, goals, the
 * recommendations shown to the client and the services. Never figures or the firm's notes.
 */
export function AdvisoryPlanScreen() {
  const { firmSlug, planId } = useParams<{ firmSlug: string; planId: string }>();
  const key = ['my-advisory', firmSlug, 'plan', planId];
  const plan = useApiQuery(key, () => api.myAdvisory(firmSlug).plan(planId));
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <Link
        href={`/${firmSlug}/services/advisory`}
        className="text-sm font-medium text-link hover:underline"
      >
        ← Business Advisory
      </Link>
      <PageState query={plan}>{(p) => <PlanView plan={p} />}</PageState>
    </div>
  );
}

function PlanView({ plan: p }: { plan: MyAdvisoryPlan }) {
  return (
    <>
      <header className="flex flex-wrap items-start gap-3" data-testid="advisory-plan-header">
        <div className="min-w-0 flex-1">
          <h1 data-testid="page-title" className="font-display text-3xl font-bold text-heading">
            {p.name}
          </h1>
          <p className="text-sm text-muted">
            {p.businessName ? `${p.businessName} · ` : ''}
            {p.targetYear} · Version {p.version} · Delivered {dayText(p.deliveredAt)}
          </p>
        </div>
        <Badge tone={PLAN_STATE_TONE[p.state]}>{MY_ADVISORY_PLAN_STATE_LABELS[p.state]}</Badge>
      </header>

      <Card title="Your plan">
        <p className="mb-3 text-sm text-muted" data-testid="read-only-note">
          Read-only: version {p.version}, exactly as your firm delivered it.
        </p>
        {p.summary ? (
          <p className="text-sm whitespace-pre-wrap text-text" data-testid="plan-summary">
            {p.summary}
          </p>
        ) : null}
        {p.focusAreas.length ? (
          <ul className="mt-3 flex flex-col" aria-label="Focus areas" data-testid="plan-focus">
            {p.focusAreas.map((f) => (
              <li key={f.area} className={row}>
                <span className="font-semibold text-heading">{AREA[f.area]}</span>
                <span className="text-sm text-text">: {f.objective}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card title="Goals">
        {p.goals.length ? (
          <ul className="flex flex-col" aria-label="Goals" data-testid="plan-goals">
            {p.goals.map((g) => (
              <li
                key={`${g.title}|${g.targetDate ?? ''}|${g.status}`}
                className={`flex flex-wrap items-center gap-2 ${row}`}
              >
                <span className="min-w-0 flex-1 font-semibold text-heading">{g.title}</span>
                {g.targetDate ? (
                  <span className="text-sm text-muted">By {dayText(g.targetDate)}</span>
                ) : null}
                <Badge tone="info">{GOAL_STATUS[g.status]}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">This version lists no goals.</p>
        )}
      </Card>

      <Card title="Recommendations">
        {p.recommendations.length ? (
          <ul
            className="flex flex-col"
            aria-label="Recommendations"
            data-testid="plan-recommendations"
          >
            {p.recommendations.map((r) => {
              const [label, tone] = REC_STATUS[r.status];
              return (
                <li key={`${r.title}|${r.status}`} className={row}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 font-semibold text-heading">{r.title}</span>
                    <Badge tone={tone}>{label}</Badge>
                  </div>
                  {r.rationale ? <p className="mt-1 text-sm text-text">{r.rationale}</p> : null}
                  {r.impactLabel ? (
                    <p className="mt-1 text-xs text-muted">Expected: {r.impactLabel}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">This version shares no recommendations.</p>
        )}
      </Card>

      {p.services.length ? (
        <Card title="Services">
          <ul className="flex flex-wrap gap-2" aria-label="Services">
            {p.services.map((s) => (
              <li key={s.name}>
                <Badge tone="info">
                  {s.name} · {SERVICE_STATUS[s.status]}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <p className="text-xs text-muted">{p.disclaimer}</p>
    </>
  );
}
