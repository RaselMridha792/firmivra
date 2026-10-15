'use client';

import { SearchField, Select } from '@firmivra/ui';
import { useDeferredValue, useState } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { GroupsHeader } from '../../_components/groups-header';
import { GroupsKpis } from '../../_components/groups-kpis';
import { GROUPS } from '../../_components/groups-shared';
import { GroupsTabs } from '../../_components/groups-tabs';
import { NeedHelpCard } from '../../_components/need-help-card';
import { type OrgPerson, OrgTree, buildTree, flatten, pruneTree } from './org-tree';
import { PersonDetails } from './person-details';

/**
 * Teams & Departments, Org Chart tab (docx §13 "Reporting hierarchy"; the design has no Org Chart
 * frame, so it follows the Departments tab): the counts, the reporting tree of the firm's active
 * staff from each person's supervisor, and the chosen person's details. Search and the department
 * filter keep each match with the people above it. Read-only: reporting lines change on the staff
 * account.
 */
export function OrgChartScreen() {
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search.trim().toLowerCase());
  const [department, setDepartment] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const chart = useApiQuery([...GROUPS, 'org-chart'], () => api.departments.orgChart());
  const departments = useApiQuery([...GROUPS, 'list', 'every'], () =>
    api.departments.list({ pageSize: 100 }),
  );
  const filtered = Boolean(query) || Boolean(department);
  const toggle = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  };

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
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select
          label="Department"
          hideLabel
          options={[
            { value: '', label: 'All Departments' },
            ...(departments.data?.items ?? []).map((d) => ({ value: d.id, label: d.name })),
          ]}
          value={department}
          onChange={(event) => setDepartment(event.target.value)}
        />
      </GroupsTabs>

      <PageState query={chart} isEmpty={() => false}>
        {(data) => {
          const tree = buildTree(data.nodes);
          const matches = (p: OrgPerson) =>
            (!query ||
              p.name.toLowerCase().includes(query) ||
              (p.jobTitle ?? '').toLowerCase().includes(query)) &&
            (!department || p.departments.some((d) => d.id === department));
          const shown = filtered ? pruneTree(tree, matches) : tree;
          const everyone = flatten(tree);
          const visible = flatten(shown);
          // A filter opens its first match, not the people above it.
          const selected =
            visible.find((p) => p.id === picked) ??
            (filtered ? visible.find(matches) : undefined) ??
            visible[0];
          const supervisor = selected?.supervisorId
            ? (everyone.find((p) => p.id === selected.supervisorId) ?? null)
            : null;
          return (
            // The Departments tab's two-to-one split, from 1440 px; narrower, the cards go under.
            <div className="grid grid-cols-1 items-start gap-4 min-[1440px]:grid-cols-3">
              <section
                aria-labelledby="org-chart"
                className="min-w-0 rounded-xl border border-divider bg-surface p-4 shadow-sm min-[1440px]:col-span-2"
              >
                <h2 id="org-chart" className="text-xl font-bold text-heading">
                  Organization Chart
                </h2>
                <p className="mb-4 text-sm text-link">
                  Who reports to whom, from each person&apos;s supervisor. Click on a person to view
                  their details.
                </p>
                {visible.length ? (
                  <>
                    <OrgTree
                      people={shown}
                      selectedId={selected?.id}
                      collapsed={filtered ? new Set() : collapsed}
                      onSelect={setPicked}
                      onToggle={toggle}
                    />
                    <p className="mt-4 text-sm text-muted" data-testid="org-count">
                      {filtered
                        ? `${everyone.filter(matches).length} of ${everyone.length} people match`
                        : `${everyone.length} active people`}
                    </p>
                  </>
                ) : (
                  <div className="rounded-lg bg-subtle p-6 text-center">
                    <p className="font-semibold text-heading">
                      {filtered ? 'No matching people' : 'No active staff yet'}
                    </p>
                    <p className="text-sm text-muted">
                      {filtered
                        ? 'Try another search or department.'
                        : 'People appear here once their staff accounts are active.'}
                    </p>
                  </div>
                )}
              </section>

              <aside className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2 min-[1440px]:grid-cols-1">
                {selected ? (
                  <PersonDetails person={selected} supervisor={supervisor} onSelect={setPicked} />
                ) : null}
                <NeedHelpCard />
              </aside>
            </div>
          );
        }}
      </PageState>
    </div>
  );
}
