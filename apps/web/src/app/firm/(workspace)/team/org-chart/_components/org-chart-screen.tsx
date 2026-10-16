'use client';

import type { OrgChartNode } from '@firmivra/types';
import { OrgChart, type OrgChartPerson, SearchField, Select, Skeleton } from '@firmivra/ui';
import { useDeferredValue, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { GroupsHeader } from '../../_components/groups-header';
import { GroupsKpis } from '../../_components/groups-kpis';
import { GROUPS } from '../../_components/groups-shared';
import { GroupsTabs } from '../../_components/groups-tabs';
import { NeedHelpCard } from '../../_components/need-help-card';
import { NOT_LOADED, QuietCard } from '../../_components/quiet-card';
import { PersonDetails } from './person-details';

/** The matches and everyone above them, so each match keeps its reporting line. */
function withBosses(nodes: OrgChartNode[], matches: OrgChartNode[]): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const keep = new Set<string>();
  for (const match of matches) {
    let at: OrgChartNode | undefined = match;
    while (at && !keep.has(at.id)) {
      keep.add(at.id);
      at = at.supervisorId ? byId.get(at.supervisorId) : undefined;
    }
  }
  return keep;
}

/** The kit chart's card: name, job title, and the departments headed (else the departments). */
const toCard = (n: OrgChartNode): OrgChartPerson => ({
  id: n.id,
  name: n.name,
  title: n.jobTitle ?? undefined,
  parentId: n.supervisorId,
  avatarSrc: n.avatarUrl ?? undefined,
  note: n.heads.length
    ? `Head of ${n.heads.map((d) => d.name).join(', ')}`
    : n.departments.map((d) => d.name).join(', ') || undefined,
});

/**
 * Teams & Departments, Org Chart tab (docx §13 "Reporting hierarchy"; the design has no Org Chart
 * frame, so it follows the Departments tab): the counts, the kit's OrgChart of the firm's active
 * staff from each person's supervisor, and one person's details. Search and the department filter
 * keep each match with the people above it, and open the first match. Read-only: reporting lines
 * change on the staff account.
 */
export function OrgChartScreen() {
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search.trim().toLowerCase());
  const [department, setDepartment] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const chart = useApiQuery([...GROUPS, 'org-chart'], () => api.departments.orgChart());
  const departments = useApiQuery([...GROUPS, 'list', 'every'], () =>
    api.departments.list({ pageSize: 100 }),
  );
  const filtered = Boolean(query) || Boolean(department);
  // The chart and its card stay when the call fails or finds no one (design-match rule 2).
  const nodes = chart.data?.nodes ?? [];
  const matches = nodes.filter(
    (n) =>
      (!query ||
        n.name.toLowerCase().includes(query) ||
        (n.jobTitle ?? '').toLowerCase().includes(query)) &&
      (!department || n.departments.some((d) => d.id === department)),
  );
  const keep = filtered ? withBosses(nodes, matches) : null;
  const shown = keep ? nodes.filter((n) => keep.has(n.id)) : nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const top = nodes.find((n) => !n.supervisorId || !byId.has(n.supervisorId));
  const selected = (picked ? byId.get(picked) : undefined) ?? (filtered ? matches[0] : top);
  const byName = (a: OrgChartNode, b: OrgChartNode) => a.name.localeCompare(b.name);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <GroupsHeader />
      <GroupsKpis />
      <GroupsTabs current="/team/org-chart">
        <SearchField
          label="Search people"
          placeholder="Search people..."
          value={search}
          minWidth="12rem"
          onChange={(event) => {
            setSearch(event.target.value);
            setPicked(null);
          }}
        />
        <Select
          label="Department"
          hideLabel
          options={[
            { value: '', label: 'All Departments' },
            ...(departments.data?.items ?? []).map((d) => ({ value: d.id, label: d.name })),
          ]}
          value={department}
          onChange={(event) => {
            setDepartment(event.target.value);
            setPicked(null);
          }}
        />
      </GroupsTabs>

      {/* The Departments tab's two-to-one split, from 1440 px; narrower, the cards go under. */}
      <div className="grid grid-cols-1 items-start gap-4 min-[1440px]:grid-cols-3">
        <section
          aria-labelledby="org-chart"
          className="min-w-0 rounded-xl border border-divider bg-surface p-4 shadow-sm min-[1440px]:col-span-2"
        >
          <h2 id="org-chart" className="text-xl font-bold text-heading">
            Organization Chart
          </h2>
          <p className="mb-4 text-sm text-link">
            Who reports to whom, from each person&apos;s supervisor. Search for a person, or move
            through the chart from Person Details.
          </p>
          {/* The kit chart is centred on the top person and scrolls sideways; it opens in
                    the middle so the top person shows, again after each filter (the key). */}
          <div
            key={shown.map((n) => n.id).join()}
            data-testid="org-chart"
            ref={(el) => {
              const box = el?.firstElementChild;
              if (box instanceof HTMLElement) {
                box.scrollLeft = (box.scrollWidth - box.clientWidth) / 2;
              }
            }}
          >
            {chart.isPending ? (
              <Skeleton className="h-48" />
            ) : (
              <OrgChart
                people={[...shown].sort(byName).map(toCard)}
                label="Organization chart"
                emptyText={
                  chart.isError
                    ? NOT_LOADED
                    : filtered
                      ? 'No matching people. Try another search or department.'
                      : 'No active staff yet. People appear here once their staff accounts are active.'
                }
              />
            )}
          </div>
          {shown.length ? (
            <p className="mt-4 text-sm text-muted" data-testid="org-count">
              {filtered
                ? `${matches.length} of ${nodes.length} people match`
                : `${nodes.length} active ${nodes.length === 1 ? 'person' : 'people'}`}
            </p>
          ) : null}
        </section>

        <aside className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2 min-[1440px]:grid-cols-1">
          {selected ? (
            <PersonDetails
              person={selected}
              supervisor={selected.supervisorId ? (byId.get(selected.supervisorId) ?? null) : null}
              reports={nodes
                .filter((n) => n.supervisorId === selected.id && n.id !== selected.id)
                .sort(byName)}
              onSelect={setPicked}
            />
          ) : (
            <QuietCard
              title="Person Details"
              testId="person-details"
              loading={chart.isPending}
              line={
                chart.isError
                  ? NOT_LOADED
                  : filtered
                    ? 'No one matches. Their details show here.'
                    : 'The chosen person’s details show here.'
              }
            />
          )}
          <NeedHelpCard />
        </aside>
      </div>
    </div>
  );
}
