'use client';

import {
  MagnifyingGlass,
  MapPin,
  Plus,
  TreeStructure,
  User,
  Users,
  UsersFour,
  UsersThree,
  type Icon,
} from '@phosphor-icons/react';
import { Button, FilterChip, IconButton, Input, Textarea } from '@firmivra/ui';
import { useId, useState } from 'react';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';
import {
  adminTeam,
  type CreateTeamGroup,
  type MessageAudience,
  type MessageOptions,
  type MessageTarget,
  TEAM_ERROR_MESSAGES,
  type TeamGroup,
} from '../../../../../mocks/admin-team';
import { TEAM_KEY } from './team-parts';

const AUDIENCES: { id: MessageAudience; label: string; icon: Icon }[] = [
  { id: 'COMPANY', label: 'Entire Company', icon: UsersThree },
  { id: 'DEPARTMENT', label: 'Department', icon: TreeStructure },
  { id: 'LOCATION', label: 'Location', icon: MapPin },
  { id: 'MEMBERS', label: 'Specific Team Members', icon: Users },
  { id: 'GROUP', label: 'Custom Group', icon: UsersFour },
];

/** The search box's label and placeholder per recipient type (Team docx §7 and §8). */
const SEARCH: Record<
  Exclude<MessageAudience, 'COMPANY'>,
  { label: string; placeholder: string }
> = {
  DEPARTMENT: { label: 'Select Department', placeholder: 'Search or select a department...' },
  LOCATION: { label: 'Select Location', placeholder: 'Search or select a location...' },
  MEMBERS: { label: 'Select Team or Team Members', placeholder: 'Search team or team member...' },
  GROUP: { label: 'Select Custom Group', placeholder: 'Search or select a custom group...' },
};

interface Choice {
  target: MessageTarget;
  label: string;
  meta: string;
  icon: Icon;
  /** What the search looks in: the name, and a person's title or a team's department. */
  search: string;
}

const keyOf = (target: MessageTarget) => `${target.kind}:${target.id}`;

function choicesFor(audience: MessageAudience, options: MessageOptions | undefined): Choice[] {
  if (!options) return [];
  const people = (count: number) => `${count} ${count === 1 ? 'person' : 'people'}`;
  switch (audience) {
    case 'DEPARTMENT':
      return options.departments.map((entry): Choice => ({
        target: { kind: 'department', id: entry.id },
        label: entry.name,
        meta: people(entry.memberCount),
        icon: TreeStructure,
        search: entry.name,
      }));
    case 'LOCATION':
      return options.locations.map((entry): Choice => ({
        target: { kind: 'location', id: entry.id },
        label: entry.name,
        meta: people(entry.memberCount),
        icon: MapPin,
        search: entry.name,
      }));
    case 'MEMBERS':
      return [
        ...options.teams.map((entry): Choice => ({
          target: { kind: 'team', id: entry.id },
          label: entry.name,
          meta: `Team, ${entry.departmentName}, ${people(entry.memberCount)}`,
          icon: UsersFour,
          search: `${entry.name} ${entry.departmentName}`,
        })),
        ...options.members.map((entry): Choice => ({
          target: { kind: 'member', id: entry.id },
          label: entry.name,
          meta: entry.jobTitle,
          icon: User,
          search: `${entry.name} ${entry.jobTitle} ${entry.departmentName}`,
        })),
      ];
    case 'GROUP':
      return options.groups.map((entry): Choice => ({
        target: { kind: 'group', id: entry.id },
        label: entry.name,
        meta: people(entry.memberCount),
        icon: UsersThree,
        search: `${entry.name} ${entry.description}`,
      }));
    default:
      return [];
  }
}

/** Step 1 of Send Message: the five recipient types and the search-or-select field. */
export function RecipientPicker({
  options,
  audience,
  onAudience,
  targets,
  onTargets,
  error,
}: {
  options: MessageOptions | undefined;
  audience: MessageAudience;
  onAudience: (audience: MessageAudience) => void;
  targets: MessageTarget[];
  onTargets: (targets: MessageTarget[]) => void;
  error?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const choices = choicesFor(audience, options);
  const picked = new Set(targets.map(keyOf));
  const needle = query.trim().toLowerCase();
  const shown = choices.filter((choice) => !needle || choice.search.toLowerCase().includes(needle));
  const labelOf = (target: MessageTarget) =>
    choices.find((choice) => keyOf(choice.target) === keyOf(target))?.label ?? 'Recipient';
  const toggle = (target: MessageTarget) =>
    onTargets(
      picked.has(keyOf(target))
        ? targets.filter((entry) => keyOf(entry) !== keyOf(target))
        : [...targets, target],
    );
  const allowed = (audienceId: MessageAudience) =>
    options?.audiences.find((entry) => entry.id === audienceId)?.allowed ??
    audienceId !== 'COMPANY';

  return (
    <div className="flex flex-col gap-3">
      <fieldset>
        <legend className="sr-only">Recipient type</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {AUDIENCES.map(({ id: audienceId, label, icon: Glyph }) => {
            const enabled = allowed(audienceId);
            const checked = audience === audienceId;
            return (
              <label
                key={audienceId}
                title={enabled ? undefined : 'Outside your messaging permissions'}
                className={`flex min-h-28 flex-col items-center justify-between gap-1 rounded-lg border p-2 text-center text-sm text-heading ${checked ? 'border-action bg-info-soft' : 'border-border bg-surface'} ${enabled ? 'cursor-pointer hover:border-action' : 'cursor-not-allowed opacity-50'}`}
              >
                <Glyph aria-hidden weight="fill" className="size-6 text-action" />
                <span className="leading-tight">{label}</span>
                <input
                  type="radio"
                  name={`${id}-audience`}
                  value={audienceId}
                  checked={checked}
                  disabled={!enabled}
                  onChange={() => {
                    onAudience(audienceId);
                    setQuery('');
                    setCreating(false);
                  }}
                  className="size-5"
                />
              </label>
            );
          })}
        </div>
      </fieldset>

      {audience === 'COMPANY' ? (
        <p className="text-sm text-muted">
          Everyone on the team you may message receives it
          {options ? ` (${options.members.length} people)` : ''}.
        </p>
      ) : (
        <div
          className="relative flex flex-col gap-1"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
          }}
          onKeyDown={(event) => {
            // Escape closes the results first, not the whole dialog.
            if (event.key === 'Escape' && open) {
              event.preventDefault();
              setOpen(false);
            }
          }}
        >
          <label htmlFor={`${id}-search`} className="text-sm font-medium text-text">
            {SEARCH[audience].label}
          </label>
          <div className="flex items-center gap-2">
            <span
              className={`flex h-11 min-w-0 flex-1 items-center gap-2 rounded-control border bg-surface px-3 focus-within:outline-2 focus-within:outline-focus ${error ? 'border-danger' : 'border-border'}`}
            >
              <MagnifyingGlass aria-hidden weight="bold" className="size-5 shrink-0 text-muted" />
              <input
                id={`${id}-search`}
                type="search"
                aria-invalid={error ? true : undefined}
                autoComplete="off"
                maxLength={100}
                placeholder={SEARCH[audience].placeholder}
                value={query}
                onFocus={() => setOpen(true)}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setOpen(true);
                }}
                className="min-h-0 w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
              />
            </span>
            {audience === 'GROUP' && options?.canCreateGroup ? (
              <IconButton
                icon={Plus}
                label="Create custom group"
                tone="action"
                weight="bold"
                aria-expanded={creating}
                onClick={() => setCreating(!creating)}
              />
            ) : null}
          </div>
          {open ? (
            <ul
              id={`${id}-results`}
              aria-label={`${SEARCH[audience].label} results`}
              className="absolute top-full right-0 left-0 z-10 mt-1 max-h-60 overflow-y-auto rounded-lg border border-divider bg-surface p-1 shadow-lg"
            >
              {shown.length ? (
                shown.map((choice) => {
                  const on = picked.has(keyOf(choice.target));
                  return (
                    <li key={keyOf(choice.target)}>
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle(choice.target)}
                        className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-canvas ${on ? 'bg-info-soft' : ''}`}
                      >
                        <choice.icon
                          aria-hidden
                          weight="fill"
                          className="size-4 shrink-0 text-action"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-text">{choice.label}</span>
                          <span className="block text-xs text-muted">{choice.meta}</span>
                        </span>
                        {on ? (
                          <span className="text-xs font-semibold text-action">Selected</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })
              ) : (
                <li className="px-3 py-2 text-sm text-muted">
                  {options
                    ? 'Nothing matches your search.'
                    : 'Could not load recipients right now.'}
                </li>
              )}
            </ul>
          ) : null}
          {targets.length ? (
            <div aria-label="Chosen recipients" className="flex flex-wrap gap-2 pt-1">
              {targets.map((target) => (
                <FilterChip
                  key={keyOf(target)}
                  label={labelOf(target)}
                  onRemove={() => toggle(target)}
                />
              ))}
            </div>
          ) : null}
          {error ? <p className="text-xs text-danger">{error}</p> : null}
          {creating && options ? (
            <CreateGroup
              options={options}
              onCancel={() => setCreating(false)}
              onCreated={(group) => {
                setCreating(false);
                onTargets([...targets, { kind: 'group', id: group.id }]);
              }}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

/** The + of Custom Group (Team docx §12): name, description and members within your scope. */
function CreateGroup({
  options,
  onCancel,
  onCreated,
}: {
  options: MessageOptions;
  onCancel: () => void;
  onCreated: (group: TeamGroup) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [problem, setProblem] = useState('');
  const create = useApiMutation((body: CreateTeamGroup) => adminTeam.createGroup(body), {
    invalidate: TEAM_KEY,
  });
  const needle = filter.trim().toLowerCase();
  const people = options.members.filter(
    (member) => !needle || `${member.name} ${member.jobTitle}`.toLowerCase().includes(needle),
  );
  function save() {
    if (!name.trim()) return setProblem('Enter a group name.');
    if (memberIds.length === 0) return setProblem('Add at least one member.');
    setProblem('');
    create.mutate({ name, description, memberIds }, { onSuccess: onCreated });
  }
  return (
    <section
      aria-label="New custom group"
      className="mt-2 flex flex-col gap-3 rounded-lg border border-divider bg-subtle p-4"
    >
      <h4 className="text-sm font-bold text-heading">New Custom Group</h4>
      <Input
        label="Group name *"
        value={name}
        maxLength={60}
        onChange={(event) => setName(event.target.value)}
      />
      <Textarea
        label="Description"
        rows={2}
        maxLength={200}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <Input
        label="Find members"
        type="search"
        value={filter}
        placeholder="Search by name or title..."
        onChange={(event) => setFilter(event.target.value)}
      />
      <fieldset className="max-h-48 overflow-y-auto rounded-lg border border-border bg-surface p-2">
        <legend className="sr-only">Members</legend>
        {people.length ? (
          people.map((member) => (
            <label key={member.id} className="flex min-h-9 items-center gap-3 px-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={memberIds.includes(member.id)}
                onChange={(event) =>
                  setMemberIds(
                    event.target.checked
                      ? [...memberIds, member.id]
                      : memberIds.filter((value) => value !== member.id),
                  )
                }
              />
              <span className="min-w-0 flex-1">
                {member.name} <span className="text-muted">· {member.jobTitle}</span>
              </span>
            </label>
          ))
        ) : (
          <p className="px-2 py-1 text-sm text-muted">No one matches your search.</p>
        )}
      </fieldset>
      {problem || create.error ? (
        <p role="alert" className="text-sm text-danger">
          {problem ||
            errorMessage(create.error, {
              ...TEAM_ERROR_MESSAGES,
              CONFLICT: 'A group with this name already exists.',
            })}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={create.isPending} onClick={save}>
          Save Group
        </Button>
      </div>
    </section>
  );
}
