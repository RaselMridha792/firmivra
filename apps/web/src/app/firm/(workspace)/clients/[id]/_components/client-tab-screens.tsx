'use client';

import { INTAKE_STATUS_LABELS, type IntakeSummary } from '@firmivra/types';
import { Badge, Card } from '@firmivra/ui';
import { useParams } from 'next/navigation';
import { OriginLink } from '../../../../../../components/origin-link';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { ServiceTasks } from '../../../tasks/_components/service-tasks';
import { dateText } from '../../_components/client-parts';
import { NotesCard } from '../messages/_components/notes-card';
import { ServicesTable } from './client-services';

// Octavia's E4: the profile's Services, Intake Forms, Tasks and Notes tabs, each the module's own
// list for this client (Tasks' shared table, Messages' internal notes), opening records with Back
// to the client (SH1).

const useClientId = () => useParams<{ id: string }>().id;

export function ClientServicesScreen() {
  return <ServicesTable clientId={useClientId()} />;
}

const INTAKE_TONE: Partial<Record<IntakeSummary['status'], 'success' | 'warning' | 'info'>> = {
  SUBMITTED: 'info',
  UNDER_REVIEW: 'info',
  COMPLETED: 'success',
  NEEDS_CORRECTION: 'warning',
};

/** The client's intake forms (R11's GET /business/clients/{id}/intakes), each opening its answers. */
export function ClientIntakesScreen() {
  const clientId = useClientId();
  const q = useApiQuery(['clients', clientId, 'intakes'], () =>
    api.intakes.listForClient(clientId),
  );
  const items = (q.data ?? []).filter((i) => i.status !== 'ARCHIVED');
  return (
    <Card
      title={
        <span className="flex flex-wrap items-center justify-between gap-2">
          Intake Forms
          <OriginLink
            href="/intake-forms/send"
            className="text-sm font-medium text-link hover:underline"
          >
            Send an Intake Form
          </OriginLink>
        </span>
      }
    >
      <div data-testid="client-intakes">
        {q.isError ? (
          <p role="alert" className="text-sm text-danger">
            Intake forms are not available right now.
          </p>
        ) : q.isPending ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted">No intake forms for this client yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {items.map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-3"
                data-testid="client-intake"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium wrap-anywhere text-text">
                    {i.service.name}
                  </span>
                  <span className="block text-xs text-muted">
                    {i.engagement.title}
                    {i.submittedAt ? ` · submitted ${dateText(i.submittedAt)}` : ''}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <Badge tone={INTAKE_TONE[i.status] ?? 'neutral'}>
                    {INTAKE_STATUS_LABELS[i.status]}
                  </Badge>
                  <OriginLink
                    href={`/intake-forms/${i.id}`}
                    className="text-sm font-medium text-link hover:underline"
                  >
                    Open
                  </OriginLink>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/** The client's open tasks: the Tasks module's own table, with Create Task for this client. */
export function ClientTasksScreen() {
  return (
    <Card title="Tasks">
      <div data-testid="client-tasks">
        <ServiceTasks clientId={useClientId()} pageSize={20} caption="The client's open tasks" />
      </div>
    </Card>
  );
}

/** The firm's internal notes on the client (Messages' notes; never shown in the portal). */
export function ClientNotesScreen() {
  return (
    <div data-testid="client-notes">
      <NotesCard clientId={useClientId()} />
    </div>
  );
}
