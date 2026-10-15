'use client';

import {
  type MembershipRole,
  type PermissionCell,
  type PermissionGrant,
  type PermissionModuleList,
  ROLES_MANAGED_BY,
  type RoleSummary,
} from '@firmivra/types';
import {
  Button,
  Callout,
  Input,
  Modal,
  PermissionMatrix,
  type PermissionValue,
  Select,
  Skeleton,
  Textarea,
} from '@firmivra/ui';
import { LockSimple, ShieldCheck } from '@phosphor-icons/react';
import { type FormEvent, useState } from 'react';
import { useFirm } from '../../../../../../components/firm-context';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorCode, errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { NeedHelpCard } from '../../_components/need-help-card';
import { CAPABILITY_ORDER, MODULE_LOOKS, NEEDS_VIEW, ROLE_ERRORS } from './role-parts';
import { PermissionNotes, QuickPresets, RoleDescription, RoleTemplates } from './role-side';
import { RolesHeader } from './roles-header';

const ROLES = ['roles'] as const;

/** The grid's value from the API's cells: the granted capabilities per module. */
function toValue(cells: PermissionCell[]): PermissionValue {
  const value: Record<string, string[]> = {};
  for (const c of cells) if (c.granted) (value[c.module] ??= []).push(c.capability);
  return value;
}

/** The whole grid as grants (PUT sends every cell shown). */
function toGrants(value: PermissionValue, modules: PermissionModuleList): PermissionGrant[] {
  return modules.modules.flatMap((m) =>
    m.capabilities.map((capability) => ({
      module: m.module,
      capability,
      granted: (value[m.module] ?? []).includes(capability),
    })),
  );
}

const date = (iso: string) => new Date(iso).toLocaleDateString('en-US', { dateStyle: 'medium' });

/**
 * Staff Management > Roles & Permissions (`/team/roles`, guide §5-6): the canonical role grid
 * shared with Settings > Users & Roles. Choose a role, see its description and members, and change
 * its Module Permissions with the kit's PermissionMatrix (create-staff-2.jpg) and Role Templates
 * (users-and-role.jpg). Owner and Admin change the roles they manage (ROLES_MANAGED_BY); the
 * Owner's grid never changes; a Manager reads. Saving more than a role's default asks first.
 */
export function RolesScreen() {
  const roles = useApiQuery([...ROLES, 'list'], () => api.roles.list());
  const modules = useApiQuery([...ROLES, 'modules'], () => api.roles.modules());
  const [picked, setPicked] = useState<MembershipRole | null>(null);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <RolesHeader />
      <PageState query={roles} isEmpty={(data) => data.items.length === 0}>
        {(data) => {
          const selected =
            data.items.find((r) => r.role === picked) ??
            data.items.find((r) => !r.locked) ??
            data.items[0];
          return selected ? (
            // A new role starts clean: the key drops the unsaved boxes of the role before.
            <RoleWorkspace
              key={selected.role}
              roles={data.items}
              selected={selected}
              modules={modules.data}
              onSelect={(r) => setPicked(r.role)}
            />
          ) : null;
        }}
      </PageState>
    </div>
  );
}

/** The chosen role: its grid with unsaved changes, Save, the presets and the side cards. */
function RoleWorkspace({
  roles,
  selected,
  modules,
  onSelect,
}: {
  roles: RoleSummary[];
  selected: RoleSummary;
  modules: PermissionModuleList | undefined;
  onSelect: (role: RoleSummary) => void;
}) {
  const { role: me } = useFirm();
  const grid = useApiQuery([...ROLES, 'permissions', selected.role], () =>
    api.roles.permissions(selected.role),
  );
  const [draft, setDraft] = useState<PermissionValue | null>(null);
  const [dialog, setDialog] = useState<'clear' | 'escalation' | 'custom' | null>(null);
  const save = useApiMutation(
    (body: { grants: PermissionGrant[]; ack?: boolean }) =>
      api.roles.savePermissions(selected.role, {
        grants: body.grants,
        acknowledgeEscalation: body.ack,
      }),
    { invalidate: ROLES },
  );
  const reset = useApiMutation(() => api.roles.resetPermissions(selected.role), {
    invalidate: ROLES,
  });
  const manages = me ? ROLES_MANAGED_BY[me] : [];
  const canChange = !selected.locked && manages.includes(selected.role);
  const value = draft ?? (grid.data ? toValue(grid.data.cells) : {});
  const changed = draft !== null;
  const submit = (ack?: boolean) => {
    if (!modules) return;
    save.mutate(
      { grants: toGrants(value, modules), ack },
      {
        onSuccess: () => {
          setDraft(null);
          setDialog(null);
        },
        onError: (error) => {
          if (errorCode(error) === 'PERMISSION_ESCALATION') setDialog('escalation');
        },
      },
    );
  };
  const saveError =
    save.error && errorCode(save.error) !== 'PERMISSION_ESCALATION' ? save.error : null;
  const lockedText = selected.locked
    ? 'The Owner role always has every permission and cannot be changed.'
    : 'You can see this role’s permissions. Only an Owner or an Admin can change the roles they manage.';

  return (
    // Create Staff's two-to-one split, from 1440 px; narrower, the side cards go under.
    <div className="grid grid-cols-1 items-start gap-4 min-[1440px]:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-4 min-[1440px]:col-span-2">
        <section
          aria-labelledby="select-role"
          className="rounded-xl border border-divider bg-surface p-4 shadow-sm"
        >
          <div className="mb-3 flex items-center gap-3">
            <span
              aria-hidden
              className="flex size-11 items-center justify-center rounded-lg bg-info-soft text-info"
            >
              <ShieldCheck weight="fill" className="size-6" />
            </span>
            <div>
              <h2 id="select-role" className="text-xl font-bold text-heading">
                Role &amp; Permissions
              </h2>
              <p className="text-sm text-link">Select a role and customize its permissions.</p>
            </div>
          </div>
          <div className="max-w-sm">
            <Select
              label="Select a Role *"
              options={roles.map((r) => ({ value: r.role, label: r.label }))}
              value={selected.role}
              onChange={(event) => {
                const next = roles.find((r) => r.role === event.target.value);
                if (next) onSelect(next);
              }}
            />
            <p className="mt-1 text-xs text-muted">
              Roles provide a set of default permissions. You can customize them below.
            </p>
          </div>
        </section>

        <section
          aria-labelledby="module-permissions"
          className="min-w-0 rounded-xl border border-divider bg-surface p-4 shadow-sm"
        >
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="module-permissions" className="text-xl font-bold text-heading">
                Module Permissions
              </h2>
              <p className="text-sm text-link">
                Select which areas {selected.label} can access and what it can do.
              </p>
            </div>
            {grid.data?.updatedAt ? (
              <p className="text-xs text-muted">
                Last changed {date(grid.data.updatedAt)}
                {grid.data.updatedBy ? ` by ${grid.data.updatedBy}` : ''}
              </p>
            ) : null}
          </div>
          {canChange ? null : (
            <div className="mb-3">
              <Callout icon={LockSimple} tone="navy" surface="plain" size="compact">
                {lockedText}
              </Callout>
            </div>
          )}
          {grid.data && modules ? (
            <PermissionMatrix
              rows={modules.modules.map((m) => ({
                id: m.module,
                label: m.label,
                icon: MODULE_LOOKS[m.module][0],
                tone: MODULE_LOOKS[m.module][1],
              }))}
              columns={CAPABILITY_ORDER.map((c) => ({
                id: c,
                label: modules.capabilities.find((x) => x.capability === c)?.label ?? c,
              }))}
              value={value}
              onChange={setDraft}
              rowHeader="Module / Page"
              fullAccess
              requires={NEEDS_VIEW}
              isAvailable={(row, column) =>
                modules.modules
                  .find((m) => m.module === row)
                  ?.capabilities.some((c) => c === column) ?? false
              }
              readOnly={!canChange}
              caption={`Module permissions for ${selected.label}`}
            />
          ) : (
            <Skeleton className="h-96" />
          )}
          {saveError ? (
            <p role="alert" className="mt-3 text-sm text-danger">
              {errorMessage(saveError, ROLE_ERRORS)}
            </p>
          ) : null}
          {canChange ? (
            <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
              {changed ? (
                <span className="mr-auto text-sm text-muted" data-testid="unsaved">
                  Unsaved changes
                </span>
              ) : null}
              <Button
                variant="secondary"
                disabled={!changed || save.isPending}
                onClick={() => {
                  setDraft(null);
                  save.reset();
                }}
              >
                Discard
              </Button>
              <Button disabled={!changed || save.isPending} onClick={() => submit()}>
                Save Changes
              </Button>
            </div>
          ) : null}
        </section>
      </div>

      <aside className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2 min-[1440px]:grid-cols-1">
        <RoleDescription role={selected} />
        <QuickPresets
          canChange={canChange}
          customized={selected.customized || changed}
          pending={reset.isPending || save.isPending}
          onDefaults={() =>
            selected.customized
              ? reset.mutate(undefined, { onSuccess: () => setDraft(null) })
              : setDraft(null)
          }
          onClear={() => setDialog('clear')}
        />
        {reset.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(reset.error, ROLE_ERRORS)}
          </p>
        ) : null}
        <RoleTemplates
          roles={roles}
          selected={selected.role}
          canChange={me === 'OWNER' || me === 'ADMIN'}
          onSelect={onSelect}
          onCreate={() => setDialog('custom')}
        />
        <PermissionNotes modules={modules} />
        <NeedHelpCard />
      </aside>

      {dialog === 'clear' ? (
        <Modal
          open
          title={`Clear every permission of ${selected.label}?`}
          onClose={() => setDialog(null)}
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              Every box turns off. Nothing changes until you choose Save Changes.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setDraft({});
                  setDialog(null);
                }}
              >
                Clear All
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
      {dialog === 'escalation' ? (
        <Modal
          open
          title={`Give ${selected.label} more than its default?`}
          onClose={() => setDialog(null)}
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              Some boxes you ticked are not in this role&apos;s default permissions. Everyone with
              the role gets them on their next page load.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button disabled={save.isPending} onClick={() => submit(true)}>
                Save Anyway
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
      {dialog === 'custom' ? (
        <CustomRoleModal roles={roles} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}

/**
 * Create Custom Role: name, description and the role it starts from. The API answers 501
 * NOT_IMPLEMENTED until custom roles have a table (R42 contract), and the modal says so.
 */
function CustomRoleModal({ roles, onClose }: { roles: RoleSummary[]; onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [basedOn, setBasedOn] = useState('');
  const [errors, setErrors] = useState<{ name?: string; basedOn?: string }>({});
  const create = useApiMutation(
    (body: Parameters<typeof api.roles.createCustom>[0]) => api.roles.createCustom(body),
    { invalidate: ROLES },
  );
  const bases = roles.filter((r) => r.role !== 'OWNER');
  function submit(event: FormEvent) {
    event.preventDefault();
    const next = {
      name: name.trim() ? undefined : 'Enter a name.',
      basedOn: basedOn ? undefined : 'Choose the role it starts from.',
    };
    setErrors(next);
    if (next.name || next.basedOn) return;
    create.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        basedOn: basedOn as Exclude<MembershipRole, 'OWNER'>,
      },
      { onSuccess: onClose },
    );
  }
  return (
    <Modal open title="Create Custom Role" onClose={onClose}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <Input
          label="Role Name *"
          maxLength={60}
          value={name}
          error={errors.name}
          onChange={(event) => setName(event.target.value)}
        />
        <Textarea
          label="Description"
          maxLength={300}
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <Select
          label="Start From *"
          options={[
            { value: '', label: 'Choose a role' },
            ...bases.map((r) => ({ value: r.role, label: r.label })),
          ]}
          value={basedOn}
          error={errors.basedOn}
          onChange={(event) => setBasedOn(event.target.value)}
        />
        {create.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(create.error, ROLE_ERRORS)}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending}>
            Create Role
          </Button>
        </div>
      </form>
    </Modal>
  );
}
