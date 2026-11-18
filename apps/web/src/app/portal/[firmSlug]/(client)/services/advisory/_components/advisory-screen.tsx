'use client';

import {
  ADVISORY_RESOURCE_FORMAT_LABELS,
  MY_ADVISORY_PLAN_STATE_LABELS,
  type MyAdvisory,
  type MyAdvisoryResource,
} from '@firmivra/types';
import { Badge, Button, Card } from '@firmivra/ui';
import {
  BookOpen,
  BriefcaseBusiness,
  ChevronRight,
  FileText,
  Lightbulb,
  ListChecks,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../../lib/query';
import { usePortal } from '../../../../layout';
import { PortalPageHeader } from '../../../_components/portal-page-header';
import {
  PLAN_STATE_TONE,
  REC_STATUS,
  SERVICE_STATUS,
  TASK_STATUS,
  dayText,
  money,
} from './advisory-parts';

const row = 'border-t border-divider py-3 first:border-t-0';

function Section({
  title,
  icon: Icon,
  testId,
  empty,
  count,
  children,
}: {
  title: string;
  icon: typeof BookOpen;
  testId: string;
  empty: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <Card>
      <section aria-label={title} data-testid={testId}>
        <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-bold text-heading">
          <Icon aria-hidden className="size-5 text-firm-text" />
          {title}
        </h2>
        {count === 0 ? <p className="text-sm text-muted">{empty}</p> : children}
      </section>
    </Card>
  );
}

/**
 * BA-CP (Client Portal Review One): /{slug}/services/advisory, the client's Business Advisory
 * under My Services. Only what the firm marked for the client: the plans it delivered (read-only),
 * the recommendations it shows, the tasks it did not hide, the resources it sent and the advisory
 * files it shared. Nothing here edits anything.
 */
export function AdvisoryScreen() {
  const { firmSlug: slug } = useParams<{ firmSlug: string }>();
  const { business } = usePortal();
  const advisory = useApiQuery(['my-advisory', slug], () => api.myAdvisory(slug).get());
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <Link href={`/${slug}/services`} className="text-sm font-medium text-link hover:underline">
        ← My Services
      </Link>
      <PortalPageHeader
        title="Business Advisory"
        subtitle={`Your business plan, recommendations and next steps from ${business.name}.`}
      />
      <PageState query={advisory}>{(a) => <AdvisoryView advisory={a} slug={slug} />}</PageState>
    </div>
  );
}

function AdvisoryView({ advisory: a, slug }: { advisory: MyAdvisory; slug: string }) {
  if (!a.enrolled) {
    return (
      <Card data-testid="advisory-none">
        <p className="font-semibold text-heading">Nothing here yet.</p>
        <p className="mt-1 text-sm text-muted">
          When your firm shares a business plan, recommendations or resources with you, they show
          here.
        </p>
      </Card>
    );
  }
  const waiting = a.plans.filter((p) => p.state === 'AWAITING_APPROVAL');
  return (
    <>
      {waiting.length ? (
        // B10: a plan the firm sent for the client's approval, before it is finalized.
        <Card data-testid="advisory-approval-callout" className="border border-warning">
          <p className="font-semibold text-heading">
            {waiting.length === 1
              ? 'A business plan is waiting for your approval.'
              : `${waiting.length} business plans are waiting for your approval.`}
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {waiting.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/${slug}/services/advisory/plans/${p.id}`}
                  className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-link hover:underline"
                >
                  Review and approve {p.name} <ChevronRight aria-hidden className="size-4" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <Card data-testid="advisory-summary">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          {a.businessName ? (
            <p className="font-semibold text-heading">
              <BriefcaseBusiness aria-hidden className="mr-1 inline size-4 text-firm-text" />
              {a.businessName}
            </p>
          ) : null}
          {a.advisor ? <p className="text-text">Your advisor: {a.advisor}</p> : null}
        </div>
        {a.services.length ? (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Advisory services">
            {a.services.map((s) => (
              <li key={s.name}>
                <Badge tone="info">
                  {s.name} · {SERVICE_STATUS[s.status]}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Section
        title="Your Business Plans"
        icon={FileText}
        testId="advisory-plans"
        count={a.plans.length}
        empty="No business plan has been delivered to you yet."
      >
        <ul className="flex flex-col" aria-label="Business plans">
          {a.plans.map((p) => (
            <li
              key={p.id}
              className={`flex flex-wrap items-center gap-x-4 gap-y-1 ${row}`}
              data-testid="advisory-plan-row"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/${slug}/services/advisory/plans/${p.id}`}
                  className="font-semibold text-link hover:underline"
                >
                  {p.name}
                </Link>
                <p className="text-sm text-muted">
                  {p.targetYear} · Version {p.version} · Delivered {dayText(p.deliveredAt)}
                  {p.approval
                    ? ` · You approved version ${p.approval.version} on ${dayText(p.approval.approvedAt)}`
                    : ''}
                </p>
              </div>
              <Badge tone={PLAN_STATE_TONE[p.state]}>
                {MY_ADVISORY_PLAN_STATE_LABELS[p.state]}
              </Badge>
              <ChevronRight aria-hidden className="size-4 text-muted" />
            </li>
          ))}
        </ul>
      </Section>

      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <Section
          title="Recommendations"
          icon={Lightbulb}
          testId="advisory-recommendations"
          count={a.recommendations.length}
          empty="No recommendations have been shared with you yet."
        >
          <ul className="flex flex-col">
            {a.recommendations.map((r) => {
              const [label, tone] = REC_STATUS[r.status];
              const impact =
                r.impactLabel ?? (r.impactCents === null ? null : `About ${money(r.impactCents)}`);
              return (
                <li key={r.id} className={row} data-testid="advisory-recommendation">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 font-semibold text-heading">{r.title}</span>
                    <Badge tone={tone}>{label}</Badge>
                  </div>
                  {r.rationale ? <p className="mt-1 text-sm text-text">{r.rationale}</p> : null}
                  {impact ? <p className="mt-1 text-xs text-muted">Expected: {impact}</p> : null}
                </li>
              );
            })}
          </ul>
        </Section>

        <Section
          title="Tasks"
          icon={ListChecks}
          testId="advisory-tasks"
          count={a.tasks.length}
          empty="No advisory tasks have been shared with you yet."
        >
          <ul className="flex flex-col">
            {a.tasks.map((t) => {
              const [label, tone] = TASK_STATUS[t.status];
              return (
                <li key={t.id} className={row} data-testid="advisory-task">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 font-semibold text-heading">{t.title}</span>
                    {t.overdue ? <Badge tone="danger">Overdue</Badge> : null}
                    <Badge tone={tone}>{label}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {t.forYou ? 'For you' : 'Your firm is on it'}
                    {t.dueOn ? ` · Due ${dayText(t.dueOn)}` : ''}
                  </p>
                  {t.details ? <p className="mt-1 text-sm text-text">{t.details}</p> : null}
                </li>
              );
            })}
          </ul>
        </Section>

        <Section
          title="Resources"
          icon={BookOpen}
          testId="advisory-resources"
          count={a.resources.length}
          empty="No resources have been sent to you yet."
        >
          <ul className="flex flex-col">
            {a.resources.map((r) => (
              <li key={r.key} className={row} data-testid="advisory-resource" id={r.key}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 font-semibold text-heading">{r.title}</span>
                  <Badge tone="info">{r.category}</Badge>
                </div>
                <p className="mt-1 text-sm text-text">{r.summary}</p>
                <p className="mt-1 text-xs text-muted">
                  Sent {dayText(r.sentAt)} · {ADVISORY_RESOURCE_FORMAT_LABELS[r.format]}
                </p>
                {r.format === 'PDF' ? <PdfDownload slug={slug} resource={r} /> : null}
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title="Shared Files"
          icon={FileText}
          testId="advisory-files"
          count={a.files.length}
          empty="No advisory files have been shared with you yet."
        >
          <ul className="flex flex-col">
            {a.files.map((f) => (
              <li key={f.id} className={`flex flex-wrap items-center gap-2 ${row}`}>
                <FileText aria-hidden className="size-4 shrink-0 text-firm-text" />
                <span className="min-w-0 flex-1 truncate text-heading">{f.fileName}</span>
                <span className="text-xs text-muted">{dayText(f.sharedAt)}</span>
              </li>
            ))}
          </ul>
          <Link
            href={`/${slug}/documents`}
            className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-link hover:underline"
          >
            Open them in My Documents <ChevronRight aria-hidden className="size-4" />
          </Link>
        </Section>
      </div>

      <p className="text-xs text-muted" data-testid="advisory-disclaimer">
        {a.disclaimer}
      </p>
    </>
  );
}

/** B28: a resource the firm sent as a PDF downloads behind a short-lived link. */
function PdfDownload({ slug, resource }: { slug: string; resource: MyAdvisoryResource }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="mt-2 flex flex-col items-start gap-1">
      <Button
        variant="secondary"
        disabled={busy}
        aria-label={`Download ${resource.title} (PDF)`}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            const link = await api.myAdvisory(slug).resourcePdf(resource.key);
            const save = document.createElement('a');
            save.href = link.url;
            save.download = `${resource.key}.pdf`;
            save.rel = 'noopener';
            save.click();
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Preparing…' : 'Download PDF'}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
