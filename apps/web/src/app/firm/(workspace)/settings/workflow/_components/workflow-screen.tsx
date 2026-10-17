'use client';

import {
  ArrowsClockwise,
  CalendarCheck,
  CheckSquare,
  FlowArrow,
  ListNumbers,
} from '@phosphor-icons/react';
import { api } from '../../../../../../lib/api';
import { moduleHref } from '../../../../../../lib/firm-modules';
import { useApiQuery } from '../../../../../../lib/query';
import {
  CardLink,
  Facts,
  Loaded,
  Quiet,
  SettingsCard,
  SettingsHeader,
} from '../../_components/settings-parts';

/**
 * Settings > Workflow & Automations (guide §11: automation defaults, assignment behavior and the
 * route to Automations). The defaults that exist today are the firm's tax-return statuses
 * (`api.taxStatuses`) and appointment types (`api.appointmentTypes`); each card opens the page
 * that changes them. Automations and Tasks are their own modules.
 */
export function WorkflowScreen() {
  const statuses = useApiQuery(['tax-statuses'], () => api.taxStatuses.list());
  const types = useApiQuery(['appointment-types', 'active'], () => api.appointmentTypes.list());
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <SettingsHeader
        icon={FlowArrow}
        title="Workflow & Automations"
        subtitle="The steps your firm's work follows, and the automations that move it along."
      />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <SettingsCard
          title="Tax Return Statuses"
          subtitle="The steps a return moves through, in order."
          icon={ListNumbers}
          testId="workflow-statuses"
          action={<CardLink href="/settings/tax-statuses">Edit Statuses</CardLink>}
        >
          <Loaded query={statuses}>
            {(list) =>
              list.length ? (
                <ol className="flex flex-col gap-1.5">
                  {list.map((s, i) => (
                    <li key={s.id} className="flex items-center gap-3 text-sm text-heading">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-info-soft text-xs font-bold text-info">
                        {i + 1}
                      </span>
                      {s.name}
                    </li>
                  ))}
                </ol>
              ) : (
                <Quiet>No statuses yet. Add the first one in Tax Statuses.</Quiet>
              )
            }
          </Loaded>
        </SettingsCard>

        <SettingsCard
          title="Appointment Types"
          subtitle="What clients and staff can book, and for how long."
          icon={CalendarCheck}
          testId="workflow-types"
          action={<CardLink href="/calendar/types">Manage Types</CardLink>}
        >
          <Loaded query={types}>
            {(list) =>
              list.length ? (
                <Facts rows={list.map((t) => [t.name, `${t.durationMinutes} minutes`])} />
              ) : (
                <Quiet>No appointment types yet.</Quiet>
              )
            }
          </Loaded>
        </SettingsCard>

        <SettingsCard
          title="Automations"
          subtitle="Reminders, follow-ups and hand-offs that run on their own."
          icon={ArrowsClockwise}
          testId="workflow-automations"
        >
          <p className="text-sm text-text">
            Automations are built and switched on in the Automations module, where each one shows
            what starts it and what it does.
          </p>
          <CardLink href={moduleHref('automations')}>Open Automations</CardLink>
        </SettingsCard>

        <SettingsCard
          title="Tasks & Assignment"
          subtitle="Who picks up new work."
          icon={CheckSquare}
          testId="workflow-tasks"
        >
          <p className="text-sm text-text">
            Work is assigned to a person on each task, return and appointment. Team leads and
            departments are set in Staff Management.
          </p>
          <div className="flex flex-wrap gap-3">
            <CardLink href={moduleHref('tasks')}>Open Tasks</CardLink>
            <CardLink href="/team/departments">Teams &amp; Departments</CardLink>
          </div>
        </SettingsCard>
      </div>
    </div>
  );
}
