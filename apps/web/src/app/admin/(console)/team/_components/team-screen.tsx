'use client';

import { PaperPlaneTilt, Plus } from '@phosphor-icons/react';
import { Button, Card, PageHeader, Pagination, type TableSort, Toast } from '@firmivra/ui';
import { useDeferredValue, useState } from 'react';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { BulkDialog, type BulkKind } from './bulk-dialog';
import { MemberCard, MemberCardSkeleton } from './member-card';
import type { MemberCommand } from './member-menu';
import { MemberProfile } from './member-profile';
import { MemberTable } from './member-table';
import { MessageDialog, type MessagePreset, type MessageVariant } from './message-dialog';
import {
  type AccessLevel,
  ADD_MEMBER_AVAILABLE,
  adminTeam,
  type AdminTeamMember,
  errorMessage,
  type MemberStatus,
  type MessageTarget,
  TEAM_ERROR_MESSAGES,
  type TeamQuery,
  type TeamSort,
  type TeamView,
} from './team-api';
import { TeamKpis } from './team-kpis';
import { ButtonLink, members as countText, QuietLine, TEAM_KEY, UNREACHABLE } from './team-parts';
import {
  type BulkCommand,
  FilterRow,
  MoreFilters,
  NO_FILTERS,
  SelectionBar,
  type TeamFilters,
} from './team-toolbar';

const PAGE_SIZES = [12, 24, 48];
const SKELETON_CARDS = ['a', 'b', 'c', 'd', 'e', 'f'];

/**
 * Team (S05): Firmivra's own people in Card or List View, with search, filters, bulk actions, the
 * member profile panel and the two Send Message dialogs. Everything shown and every button comes
 * from what the signed-in admin may see and do (the API decides; team-api.ts, or the mock).
 */
export function TeamScreen() {
  const viewer = useApiQuery([...TEAM_KEY, 'viewer'], () => adminTeam.viewer());
  const summary = useApiQuery([...TEAM_KEY, 'summary'], () => adminTeam.summary());
  const filterOptions = useApiQuery([...TEAM_KEY, 'filter-options'], () =>
    adminTeam.filterOptions(),
  );
  const preference = useApiQuery([...TEAM_KEY, 'view'], () => adminTeam.viewPreference());
  const saveView = useApiMutation((next: TeamView) => adminTeam.setViewPreference(next));
  const [chosenView, setChosenView] = useState<TeamView | null>(null);
  const view = chosenView ?? preference.data ?? 'card';

  const [search, setSearch] = useState('');
  const searchText = useDeferredValue(search.trim());
  const [filters, setFilters] = useState<TeamFilters>(NO_FILTERS);
  const [sort, setSort] = useState<{ id: TeamSort; descending: boolean }>({
    id: 'name',
    descending: false,
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0] ?? 12);
  const [selected, setSelected] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [message, setMessage] = useState<{
    variant: MessageVariant;
    preset?: MessagePreset;
  } | null>(null);
  const [bulk, setBulk] = useState<{
    kind: BulkKind;
    people: AdminTeamMember[];
    status?: MemberStatus;
  } | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const query: TeamQuery = {
    search: searchText || undefined,
    departmentId: filters.departmentId || undefined,
    roleId: filters.roleId || undefined,
    status: (filters.status || undefined) as MemberStatus | undefined,
    locationId: filters.locationId || undefined,
    teamId: filters.teamId || undefined,
    accessLevel: (filters.accessLevel || undefined) as AccessLevel | undefined,
    reportsToId: filters.reportsToId || undefined,
    sort: sort.id,
    descending: sort.descending,
    page,
    pageSize,
  };
  const list = useApiQuery([...TEAM_KEY, 'members', query], () => adminTeam.members(query));
  const profile = useApiQuery([...TEAM_KEY, 'member', profileId], () =>
    profileId ? adminTeam.member(profileId) : Promise.resolve(null),
  );
  const items = list.data?.items ?? [];
  const can = viewer.data?.can;
  /** The viewer call failed: buttons that depend on the admin's rights show disabled, not hidden. */
  const rightsUnknown = viewer.isError && !viewer.data;

  const report = {
    onSuccess: (text: string) => setFeedback({ ok: true, text }),
    onError: (error: Error) =>
      setFeedback({ ok: false, text: errorMessage(error, TEAM_ERROR_MESSAGES) }),
  };
  const resend = useApiMutation((ids: string[]) => adminTeam.resendInvitation(ids), {
    invalidate: TEAM_KEY,
  });
  const decide = useApiMutation(
    ({ id, decision }: { id: string; decision: 'APPROVE' | 'REJECT' }) =>
      adminTeam.decideApproval(id, decision),
    { invalidate: TEAM_KEY },
  );

  /** Any change of what the list shows starts again at page 1 with nothing selected. */
  const restart = () => {
    setPage(1);
    setSelected([]);
  };
  const setFilter = (key: keyof TeamFilters, value: string) => {
    setFilters({ ...filters, [key]: value });
    restart();
  };
  const extraFilters = [filters.teamId, filters.accessLevel, filters.reportsToId].filter(
    Boolean,
  ).length;
  const filtered = Boolean(searchText) || Object.values(filters).some(Boolean);
  const selectedPeople = items.filter((member) => selected.includes(member.id));

  function onMember(command: MemberCommand, member: AdminTeamMember) {
    // A dialog opened from the profile panel replaces it; approve and reject keep it open.
    if (['message', 'suspend', 'reactivate', 'remove'].includes(command)) setProfileId(null);
    if (command === 'profile') setProfileId(member.id);
    else if (command === 'message')
      setMessage({
        variant: 'internal',
        preset: { audience: 'MEMBERS', targets: [{ kind: 'member', id: member.id }] },
      });
    else if (command === 'suspend')
      setBulk({ kind: 'status', people: [member], status: 'SUSPENDED' });
    else if (command === 'reactivate')
      setBulk({ kind: 'status', people: [member], status: 'ACTIVE' });
    else if (command === 'remove') setBulk({ kind: 'remove', people: [member] });
    else if (command === 'resend')
      resend.mutate([member.id], {
        onSuccess: () => report.onSuccess(`Invitation sent again to ${member.name}.`),
        onError: report.onError,
      });
    else
      decide.mutate(
        { id: member.id, decision: command === 'approve' ? 'APPROVE' : 'REJECT' },
        {
          // The API sends no invitation on approval yet (`invitationSent` false).
          onSuccess: (decided) =>
            report.onSuccess(
              command !== 'approve'
                ? `${member.name}'s role assignment was rejected.`
                : decided.invitationSent === false
                  ? `${member.name}'s role is approved. No invitation was sent yet.`
                  : `${member.name}'s role is approved and the invitation is on its way.`,
            ),
          onError: report.onError,
        },
      );
  }

  function onBulk(command: BulkCommand) {
    if (selectedPeople.length === 0) {
      setFeedback({ ok: false, text: 'Select one or more team members first.' });
      return;
    }
    if (command === 'message')
      setMessage({
        variant: 'internal',
        preset: {
          audience: 'MEMBERS',
          targets: selectedPeople.map((member): MessageTarget => ({
            kind: 'member',
            id: member.id,
          })),
        },
      });
    else if (command === 'resend')
      resend.mutate(
        selectedPeople.map((member) => member.id),
        {
          onSuccess: ({ sent }) =>
            report.onSuccess(
              sent
                ? `Invitation sent again to ${countText(sent)}.`
                : 'No one selected is waiting for an invitation.',
            ),
          onError: report.onError,
        },
      );
    else setBulk({ kind: command, people: selectedPeople });
  }

  const first = list.data && list.data.total ? (list.data.page - 1) * list.data.pageSize + 1 : 0;
  const last = list.data ? first + list.data.items.length - 1 : 0;
  // A failed list keeps its footer on one page of nothing.
  const total = list.data?.total ?? 0;

  return (
    <div data-testid="team-screen" className="flex min-w-0 flex-col gap-5">
      <PageHeader
        title="Team"
        subtitle="Manage your team, roles, and access. Empowering people to keep Firmivra running smoothly."
        actions={
          <>
            <Button variant="outline" onClick={() => setMessage({ variant: 'channels' })}>
              <PaperPlaneTilt aria-hidden weight="fill" className="size-5" />
              Team Communication
            </Button>
            {/* On the API the button stays (the design's) until R2's invite route: the Add page's
                submit says adding is not available yet. */}
            {can?.add || (can && !ADD_MEMBER_AVAILABLE) ? (
              <ButtonLink href="/team/new">
                <Plus aria-hidden weight="bold" className="size-5" />
                Add Team Member
              </ButtonLink>
            ) : rightsUnknown ? (
              <Button disabled>
                <Plus aria-hidden weight="bold" className="size-5" />
                Add Team Member
              </Button>
            ) : null}
          </>
        }
      />

      {feedback ? (
        <Toast
          tone={feedback.ok ? 'success' : 'error'}
          message={feedback.text}
          onDismiss={() => setFeedback(null)}
        />
      ) : null}

      <TeamKpis summary={summary} />

      <FilterRow
        search={search}
        onSearch={(value) => {
          setSearch(value);
          restart();
        }}
        filters={filters}
        onFilter={setFilter}
        options={filterOptions}
        view={view}
        onView={(next) => {
          setChosenView(next);
          saveView.mutate(next);
        }}
      />

      <SelectionBar
        count={selected.length}
        pageCount={items.length}
        onToggleAll={(on) => setSelected(on ? items.map((member) => member.id) : [])}
        can={can}
        rightsUnknown={rightsUnknown}
        onCommand={onBulk}
        onClear={() => setSelected([])}
        extraFilters={extraFilters}
        filtersOpen={filtersOpen}
        onFiltersOpen={setFiltersOpen}
      />

      {filtersOpen ? (
        <MoreFilters
          filters={filters}
          onFilter={setFilter}
          options={filterOptions.data}
          onClear={() => {
            setFilters(NO_FILTERS);
            setSearch('');
            restart();
          }}
        />
      ) : null}

      <section aria-label="Team members" data-testid="team-members" data-view={view}>
        {list.isPending ? (
          view === 'card' ? (
            <div
              role="status"
              aria-label="Loading team members"
              className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 min-[1600px]:grid-cols-4"
            >
              {SKELETON_CARDS.map((key) => (
                <MemberCardSkeleton key={key} />
              ))}
            </div>
          ) : (
            <Card variant="elevated" className="overflow-hidden !p-0">
              <MemberTable
                rows={[]}
                loading
                sort={sort}
                onSort={() => undefined}
                selected={[]}
                onSelected={() => undefined}
                onCommand={onMember}
              />
            </Card>
          )
        ) : list.isError && !list.data ? (
          <Card variant="elevated" className="!p-0">
            <QuietLine testId="team-unreachable">{UNREACHABLE}</QuietLine>
          </Card>
        ) : items.length === 0 ? (
          <Card variant="elevated" className="!p-0">
            <QuietLine testId="team-empty">
              {filtered
                ? 'No team members match your search or filters.'
                : 'No team members yet. People you add appear here.'}
            </QuietLine>
          </Card>
        ) : view === 'card' ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 min-[1600px]:grid-cols-4">
            {items.map((member) => (
              <MemberCard
                key={member.id}
                member={member}
                selected={selected.includes(member.id)}
                onSelect={(on) =>
                  setSelected(
                    on ? [...selected, member.id] : selected.filter((id) => id !== member.id),
                  )
                }
                onCommand={onMember}
              />
            ))}
          </div>
        ) : (
          <Card variant="elevated" className="overflow-hidden !p-0">
            <MemberTable
              rows={items}
              loading={false}
              sort={sort}
              onSort={(next: TableSort) => {
                setSort({ id: next.id as TeamSort, descending: next.descending });
                restart();
              }}
              selected={selected}
              onSelected={setSelected}
              onCommand={onMember}
            />
          </Card>
        )}
      </section>

      {list.isPending ? null : (
        <Pagination
          page={list.data?.page ?? 1}
          pageCount={Math.max(1, Math.ceil(total / (list.data?.pageSize ?? pageSize)))}
          onPage={(next) => {
            setPage(next);
            setSelected([]);
          }}
          summary={
            total ? `Showing ${first}–${last} of ${countText(total)}` : 'Showing 0 team members'
          }
          pageSize={pageSize}
          pageSizes={PAGE_SIZES}
          onPageSize={(size) => {
            setPageSize(size);
            restart();
          }}
        />
      )}

      <MemberProfile
        member={profileId ? (profile.data ?? null) : null}
        onClose={() => setProfileId(null)}
        onCommand={onMember}
      />

      {message ? (
        <MessageDialog
          variant={message.variant}
          preset={message.preset}
          onClose={() => setMessage(null)}
          onSent={report.onSuccess}
        />
      ) : null}

      {bulk ? (
        <BulkDialog
          kind={bulk.kind}
          people={bulk.people}
          initialStatus={bulk.status}
          onClose={() => setBulk(null)}
          onDone={(text) => {
            report.onSuccess(text);
            setSelected([]);
          }}
        />
      ) : null}
    </div>
  );
}
