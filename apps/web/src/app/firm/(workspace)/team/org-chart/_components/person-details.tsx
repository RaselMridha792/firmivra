import type { OrgChartNode } from '@firmivra/types';
import { Avatar, Badge } from '@firmivra/ui';
import { ArrowRight, Crown } from '@phosphor-icons/react';
import Link from 'next/link';
import { PersonCell } from '../../_components/groups-shared';
import type { OrgPerson } from './org-tree';

/**
 * The chosen person, drawn like the Departments tab's details panel: who they report to, who
 * reports to them, their departments and the departments they head. Reporting lines change on
 * the person's staff account (Supervisor / Manager), so this panel links there.
 */
export function PersonDetails({
  person,
  supervisor,
  onSelect,
}: {
  person: OrgPerson;
  supervisor: OrgChartNode | null;
  onSelect: (id: string) => void;
}) {
  const fact = 'flex gap-3 border-t border-divider py-1.5 text-sm';
  const term = 'w-24 shrink-0 border-r border-divider font-semibold text-heading';
  return (
    <section
      aria-labelledby="person-details"
      className="rounded-xl border border-divider bg-surface p-4 shadow-sm"
      data-testid="person-details"
    >
      <h2 id="person-details" className="mb-3 text-base font-bold text-heading">
        Person Details
      </h2>
      <div className="mb-3 flex items-center gap-4">
        <Avatar name={person.name} src={person.avatarUrl ?? undefined} size="xl" />
        <div className="min-w-0">
          <p className="truncate text-xl font-bold text-heading">{person.name}</p>
          {person.jobTitle ? <p className="text-sm text-link">{person.jobTitle}</p> : null}
        </div>
      </div>
      <dl>
        <div className={`${fact} flex-wrap`}>
          <dt className={term}>Reports To</dt>
          <dd className="min-w-48 flex-1">
            {supervisor ? (
              <button
                type="button"
                onClick={() => onSelect(supervisor.id)}
                className="text-left hover:underline"
              >
                <PersonCell person={supervisor} />
              </button>
            ) : (
              <span className="text-muted">No one: top of the chart</span>
            )}
          </dd>
        </div>
        <div className={fact}>
          <dt className={term}>Direct Reports</dt>
          <dd className="min-w-0 flex-1">
            {person.reports.length ? (
              <ul className="flex flex-col gap-1">
                {person.reports.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(r.id)}
                      className="text-left text-link hover:underline"
                    >
                      {r.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-muted">None</span>
            )}
          </dd>
        </div>
        <div className={fact}>
          <dt className={term}>Departments</dt>
          <dd className="flex min-w-0 flex-1 flex-wrap gap-2">
            {person.departments.length ? (
              person.departments.map((d) => (
                <Badge key={d.id} tone="info">
                  {d.name}
                </Badge>
              ))
            ) : (
              <span className="text-muted">None</span>
            )}
          </dd>
        </div>
        <div className={fact}>
          <dt className={term}>Heads</dt>
          <dd className="flex min-w-0 flex-1 flex-wrap gap-2">
            {person.heads.length ? (
              person.heads.map((d) => (
                <Badge key={d.id} tone="warning" icon={Crown}>
                  {d.name}
                </Badge>
              ))
            ) : (
              <span className="text-muted">No department</span>
            )}
          </dd>
        </div>
      </dl>
      <Link
        href={`/team/${person.id}`}
        className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-action text-sm font-semibold text-action hover:bg-folder-surface"
      >
        View Profile
        <ArrowRight aria-hidden weight="bold" className="size-4" />
      </Link>
    </section>
  );
}
