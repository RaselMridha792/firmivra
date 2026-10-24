'use client';

import type { RequestTemplate } from '@firmivra/types';
import { Card, Skeleton } from '@firmivra/ui';
import {
  CheckCircle,
  FilePlus,
  FileText,
  PaperPlaneTilt,
  Plus,
  UploadSimple,
  WarningCircle,
  type Icon,
} from '@phosphor-icons/react';
import type { UseQueryResult } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { type RequestEvent, requestActivity, timeAgo } from './requests-parts';

const EVENT_LOOKS: Record<RequestEvent['kind'], { icon: Icon; tone: string }> = {
  sent: { icon: PaperPlaneTilt, tone: 'bg-info-soft text-info' },
  uploaded: { icon: UploadSimple, tone: 'bg-success-soft text-success' },
  completed: { icon: CheckCircle, tone: 'bg-success-soft text-success' },
  overdue: { icon: WarningCircle, tone: 'bg-danger-soft text-danger' },
};
const quiet = 'rounded-control bg-canvas p-3 text-sm text-muted';

/** The dashboard's right column: Create a New Request, Request Templates, Recent Activity. */
export function RequestsRail({
  createHref,
  templates,
}: {
  createHref: string;
  templates: UseQueryResult<RequestTemplate[]>;
}) {
  const latest = useApiQuery(['document-requests', 'latest'], () =>
    api.documentLibrary.requests({ tab: 'all', sort: 'newest', pageSize: 10 }),
  );
  const events = requestActivity(latest.data?.items ?? []);
  return (
    <aside className="flex min-w-0 flex-col gap-4" aria-label="Templates and activity">
      <Card
        className="flex flex-col items-center gap-3 p-4 text-center"
        data-testid="create-request-card"
      >
        <h2 className="self-start text-lg font-bold text-heading">Create a New Request</h2>
        <FilePlus aria-hidden weight="duotone" className="size-12 text-action" />
        <p className="text-sm text-text">
          Request specific documents from clients or team members.
        </p>
        <Link
          href={createHref}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action-hover"
        >
          <Plus aria-hidden weight="bold" className="size-4" />
          Create Document Request
        </Link>
      </Card>

      <Card className="flex flex-col gap-3 p-4" data-testid="request-templates">
        <h2 className="text-lg font-bold text-heading">Request Templates</h2>
        {templates.isPending ? (
          <Skeleton className="h-32" />
        ) : templates.isError ? (
          <p className={quiet}>Templates are not available right now.</p>
        ) : !templates.data.length ? (
          <p className={quiet}>No request templates yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {templates.data.slice(0, 5).map((t) => (
              <li key={t.id} className="flex items-start gap-3">
                <FileText
                  aria-hidden
                  weight="regular"
                  className="mt-0.5 size-6 shrink-0 text-heading"
                />
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium break-words text-heading">{t.name}</span>
                  <span className="text-xs text-muted">
                    {t.items.length} document{t.items.length === 1 ? '' : 's'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-4" data-testid="request-activity">
        <h2 className="text-lg font-bold text-heading">Recent Activity</h2>
        {latest.isPending ? (
          <Skeleton className="h-32" />
        ) : latest.isError ? (
          <p className={quiet}>Activity is not available right now.</p>
        ) : !events.length ? (
          <p className={quiet}>No request activity yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {events.map((e) => {
              const look = EVENT_LOOKS[e.kind];
              return (
                <li key={e.key} className="flex items-start gap-3">
                  <span
                    className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full ${look.tone}`}
                  >
                    <look.icon aria-hidden weight="bold" className="size-4" />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-sm break-words text-heading">{e.text}</span>
                    <span className="text-xs text-muted">{timeAgo(e.at)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </aside>
  );
}
