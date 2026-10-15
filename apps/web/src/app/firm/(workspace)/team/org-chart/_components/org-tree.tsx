'use client';

import type { OrgChartNode } from '@firmivra/types';
import { Avatar, Badge } from '@firmivra/ui';
import { CaretDown, CaretRight, Crown, UsersThree } from '@phosphor-icons/react';

/** A person with the people who report to them. */
export interface OrgPerson extends OrgChartNode {
  reports: OrgPerson[];
}

/**
 * Builds the reporting tree from each person's `supervisorId`. A person whose supervisor is not on
 * the chart (not active) starts a tree of their own; a loop in the lines is broken where it is
 * found, so nobody drops off the chart.
 */
export function buildTree(nodes: OrgChartNode[]): OrgPerson[] {
  const byId = new Map<string, OrgPerson>(nodes.map((n) => [n.id, { ...n, reports: [] }]));
  const roots: OrgPerson[] = [];
  for (const person of byId.values()) {
    const boss = person.supervisorId ? byId.get(person.supervisorId) : undefined;
    if (boss && boss !== person) boss.reports.push(person);
    else roots.push(person);
  }
  const seen = new Set<string>();
  const walk = (p: OrgPerson) => {
    seen.add(p.id);
    p.reports = p.reports.filter((r) => !seen.has(r.id));
    p.reports.forEach(walk);
  };
  roots.forEach(walk);
  for (const person of byId.values()) {
    if (!seen.has(person.id)) {
      roots.push(person);
      walk(person);
    }
  }
  const byName = (a: OrgPerson, b: OrgPerson) => a.name.localeCompare(b.name);
  const sort = (list: OrgPerson[]): OrgPerson[] =>
    list.sort(byName).map((p) => ({ ...p, reports: sort(p.reports) }));
  return sort(roots);
}

/** Keeps the people who match and everyone above them, so each match shows its reporting line. */
export function pruneTree(list: OrgPerson[], match: (p: OrgPerson) => boolean): OrgPerson[] {
  return list.flatMap((p) => {
    const reports = pruneTree(p.reports, match);
    return match(p) || reports.length ? [{ ...p, reports }] : [];
  });
}

/** Everyone in the tree, top first. */
export function flatten(list: OrgPerson[]): OrgPerson[] {
  return list.flatMap((p) => [p, ...flatten(p.reports)]);
}

/** One level of the chart; each person's reports hang under them on a line. */
export function OrgTree({
  people,
  selectedId,
  collapsed,
  onSelect,
  onToggle,
  nested = false,
}: {
  people: OrgPerson[];
  selectedId: string | undefined;
  collapsed: Set<string>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
  nested?: boolean;
}) {
  return (
    <ul className={nested ? 'mt-2 ml-5 flex flex-col gap-2' : 'flex flex-col gap-2'}>
      {people.map((p) => {
        const open = !collapsed.has(p.id);
        const chosen = p.id === selectedId;
        return (
          <li
            key={p.id}
            // The line down from the boss (it stops at the last report) and the line across.
            className={
              nested
                ? 'relative pl-5 before:absolute before:-top-2 before:bottom-0 before:left-0 before:border-l-2 before:border-divider after:absolute after:top-7 after:left-0 after:w-5 after:border-t-2 after:border-divider last:before:bottom-auto last:before:h-9'
                : undefined
            }
          >
            <div
              className={`flex min-w-0 items-center gap-2 rounded-lg border p-2 ${chosen ? 'border-action bg-folder-surface' : 'border-divider bg-surface'}`}
            >
              {p.reports.length ? (
                <button
                  type="button"
                  aria-expanded={open}
                  aria-label={`${open ? 'Hide' : 'Show'} the people who report to ${p.name}`}
                  onClick={() => onToggle(p.id)}
                  className="flex size-8 shrink-0 items-center justify-center rounded-md text-heading hover:bg-subtle"
                >
                  {open ? (
                    <CaretDown aria-hidden weight="bold" className="size-4" />
                  ) : (
                    <CaretRight aria-hidden weight="bold" className="size-4" />
                  )}
                </button>
              ) : (
                <span aria-hidden className="size-8 shrink-0" />
              )}
              <button
                type="button"
                aria-pressed={chosen}
                data-testid="org-person"
                onClick={() => onSelect(p.id)}
                className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-left"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <Avatar name={p.name} src={p.avatarUrl ?? undefined} size="md" />
                  <span className="min-w-0 text-sm">
                    <span className="block truncate font-semibold text-heading">{p.name}</span>
                    {p.jobTitle ? (
                      <span className="block truncate text-xs text-link">{p.jobTitle}</span>
                    ) : null}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2 sm:ml-auto">
                  {p.heads.map((d) => (
                    <Badge key={d.id} tone="warning" icon={Crown}>
                      Head of {d.name}
                    </Badge>
                  ))}
                  {p.departments
                    .filter((d) => !p.heads.some((h) => h.id === d.id))
                    .map((d) => (
                      <Badge key={d.id} tone="info">
                        {d.name}
                      </Badge>
                    ))}
                  {p.reports.length ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted">
                      <UsersThree aria-hidden weight="fill" className="size-4" />
                      {p.reports.length} {p.reports.length === 1 ? 'report' : 'reports'}
                    </span>
                  ) : null}
                </span>
              </button>
            </div>
            {p.reports.length && open ? (
              <OrgTree
                people={p.reports}
                selectedId={selectedId}
                collapsed={collapsed}
                onSelect={onSelect}
                onToggle={onToggle}
                nested
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
