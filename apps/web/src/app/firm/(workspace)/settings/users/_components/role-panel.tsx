'use client';

import type {
  MembershipRole,
  PermissionCapability,
  PermissionGrant,
  PermissionModule,
  PermissionModuleList,
  RoleSummary,
} from '@firmivra/types';
import {
  Button,
  Callout,
  Modal,
  PermissionMatrix,
  type PermissionValue,
  Select,
  Skeleton,
} from '@firmivra/ui';
import { ArrowCounterClockwise, Info } from '@phosphor-icons/react';
import { createElement, useState } from 'react';
import { useFirm } from '../../../../../../components/firm-context';
import { api } from '../../../../../../lib/api';
import { errorCode, errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { MODULE_LOOKS, NEEDS_VIEW, ROLE_ERRORS } from '../../../team/roles/_components/role-parts';
import { BandCard, NOT_LOADED } from '../../_components/settings-parts';

/** The design's six columns; Admin is the contract's MANAGE (Delete follows the role). */
export const COLUMNS: [PermissionCapability, string][] = [
  ['VIEW', 'View'],
  ['CREATE', 'Create'],
  ['EDIT', 'Edit'],
  ['APPROVE', 'Approve'],
  ['EXPORT', 'Export'],
  ['MANAGE', 'Admin'],
];

const toValue = (cells: readonly { module: string; capability: string; granted: boolean }[]) => {
  const value: Record<string, string[]> = {};
  for (const c of cells) if (c.granted) (value[c.module] ??= []).push(c.capability);
  return value;
};

/** The whole grid as grants; Delete is kept as the role has it (not a column here). */
function toGrants(
  value: PermissionValue,
  base: PermissionValue,
  modules: PermissionModuleList,
): PermissionGrant[] {
  return modules.modules.flatMap((m) =>
    m.capabilities.map((capability) => ({
      module: m.module,
      capability,
      granted: (capability === 'DELETE' ? base : value)[m.module]?.includes(capability) ?? false,
    })),
  );
}

/**
 * Role Permissions, Module Permissions and Permission Details (users-and-role.jpg, guide §5, §8):
 * the same role grid as Staff Management's Roles & Permissions (`api.roles`), with the design's
 * six columns; the module row you click shows in Permission Details. Saving more than the role's
 * default asks first (409 PERMISSION_ESCALATION).
 */
export function RolePanel({
  roles,
  selected,
  onSelect,
}: {
  roles: RoleSummary[];
  selected: RoleSummary | undefined;
  onSelect: (role: MembershipRole) => void;
}) {
  const { role: me } = useFirm();
  const modules = useApiQuery(['roles', 'modules'], () => api.roles.modules());
  const grid = useApiQuery(['roles', 'permissions', selected?.role ?? 'none'], () =>
    selected ? api.roles.permissions(selected.role) : Promise.resolve(null),
  );
  const [draft, setDraft] = useState<PermissionValue | null>(null);
  const [asking, setAsking] = useState(false);
  const [detail, setDetail] = useState<PermissionModule | ''>('');
  const [done, setDone] = useState('');
  const base = grid.data ? toValue(grid.data.cells) : {};
  const value = draft ?? base;
  const canChange = Boolean(selected) && !selected?.locked && (me === 'OWNER' || me === 'ADMIN');
  const save = useApiMutation(
    (ack: boolean) =>
      selected && modules.data
        ? api.roles.savePermissions(selected.role, {
            grants: toGrants(value, base, modules.data),
            acknowledgeEscalation: ack,
          })
        : Promise.reject(new Error('Nothing to save')),
    { invalidate: ['roles'] },
  );
  const reset = useApiMutation(
    () => (selected ? api.roles.resetPermissions(selected.role) : Promise.resolve(null)),
    { invalidate: ['roles'] },
  );
  const submit = (ack: boolean) =>
    save.mutate(ack, {
      onSuccess: () => {
        setDraft(null);
        setAsking(false);
        setDone('Permissions saved.');
      },
      onError: (error) => {
        if (errorCode(error) === 'PERMISSION_ESCALATION') setAsking(true);
      },
    });
  // A row's boxes are named "Clients: View", so the row's module is the part before ": ".
  const pickRow = (target: EventTarget) => {
    const name = (target as HTMLElement)
      .closest('tr')
      ?.querySelector('input')
      ?.getAttribute('aria-label');
    const found = modules.data?.modules.find((m) => m.label === name?.split(': ')[0]);
    if (found) setDetail(found.module);
  };
  const moduleInfo =
    modules.data?.modules.find((m) => m.module === detail) ?? modules.data?.modules[0];
  const error = save.error && errorCode(save.error) !== 'PERMISSION_ESCALATION' ? save.error : null;

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 min-[1440px]:grid-cols-[1.15fr_2fr_1fr]">
      <BandCard title="Role Permissions" testId="role-permissions" className="self-stretch">
        <div className="flex flex-1 flex-col gap-3 p-4 pt-2">
          <p className="text-sm text-text">Select a role to view or edit permissions.</p>
          {selected ? (
            <Select
              label="Role"
              options={roles.map((r) => ({ value: r.role, label: r.label }))}
              value={selected.role}
              onChange={(event) => {
                setDraft(null);
                setDone('');
                onSelect(event.target.value as MembershipRole);
              }}
            />
          ) : (
            <Select
              label="Role"
              disabled
              options={[{ value: '', label: 'No roles' }]}
              value=""
              onChange={() => undefined}
            />
          )}
          <Button
            className="mt-1 min-h-12 text-base"
            disabled={!canChange || save.isPending}
            onClick={() => (draft === null ? setDone('No changes to save.') : submit(false))}
          >
            Save Changes
          </Button>
          <button
            type="button"
            disabled={!canChange || reset.isPending}
            onClick={() =>
              reset.mutate(undefined, {
                onSuccess: () => {
                  setDraft(null);
                  setDone('Back to the default permissions.');
                },
              })
            }
            className="inline-flex min-h-9 items-center gap-1.5 self-end text-sm text-action hover:underline disabled:cursor-not-allowed disabled:text-muted disabled:no-underline"
          >
            <ArrowCounterClockwise aria-hidden weight="bold" className="size-4" />
            Reset to Default
          </button>
          {error || reset.error ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(error ?? reset.error, ROLE_ERRORS)}
            </p>
          ) : done ? (
            <p role="status" data-testid="role-saved" className="text-sm text-success">
              {done}
            </p>
          ) : draft ? (
            <p className="text-sm text-muted">Unsaved changes</p>
          ) : null}
          {selected?.locked ? (
            <p className="text-xs text-muted">The Owner role always has every permission.</p>
          ) : null}
        </div>
      </BandCard>

      <BandCard
        title="Module Permissions"
        testId="module-permissions"
        // Under the two small cards until the page is wide enough for the design's three columns.
        className="self-stretch lg:order-last lg:col-span-2 min-[1440px]:order-none min-[1440px]:col-span-1"
      >
        {/* Clicking or tabbing into a module's row shows it in Permission Details. */}
        <div
          className="max-h-80 overflow-y-auto px-3 pb-3 [&_table]:text-xs [&_td]:px-1 [&_td]:py-1 [&_th]:px-1.5 [&_th]:py-1.5 [&_input]:size-4 [&>div]:rounded-none [&>div]:border-0"
          onClickCapture={(event) => pickRow(event.target)}
          onFocusCapture={(event) => pickRow(event.target)}
        >
          {grid.data && modules.data ? (
            <PermissionMatrix
              rows={modules.data.modules.map((m) => ({ id: m.module, label: m.label }))}
              columns={COLUMNS.map(([id, label]) => ({ id, label }))}
              value={value}
              onChange={
                canChange
                  ? (next) => {
                      setDraft(next);
                      setDone('');
                    }
                  : undefined
              }
              readOnly={!canChange}
              rowHeader="Module"
              requires={NEEDS_VIEW}
              isAvailable={(row, column) =>
                modules.data?.modules
                  .find((m) => m.module === row)
                  ?.capabilities.some((c) => c === column) ?? false
              }
              caption={`Module permissions for ${selected?.label ?? 'this role'}`}
            />
          ) : grid.isError || modules.isError || (!selected && !grid.isPending) ? (
            <PermissionMatrix rows={[]} columns={[]} value={{}} emptyText={NOT_LOADED} />
          ) : (
            <Skeleton className="h-72" />
          )}
        </div>
      </BandCard>

      <BandCard title="Permission Details" testId="permission-details" className="self-stretch">
        <div className="flex flex-1 flex-col gap-4 p-4">
          {moduleInfo ? (
            <div className="flex gap-3" data-testid="permission-detail">
              <span
                aria-hidden
                className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-info-soft text-action"
              >
                {createElement(MODULE_LOOKS[moduleInfo.module][0], {
                  weight: 'fill',
                  className: 'size-7',
                })}
              </span>
              <div className="min-w-0">
                <p className="font-bold text-heading">{moduleInfo.label}</p>
                <p className="text-xs text-muted">{moduleInfo.description}</p>
              </div>
            </div>
          ) : modules.isPending ? (
            <Skeleton className="h-20" />
          ) : (
            <p className="rounded-lg bg-subtle p-4 text-sm text-muted">{NOT_LOADED}</p>
          )}
          <div className="border-t border-divider pt-4">
            <Callout icon={Info} tone="navy" surface="info" size="compact">
              <span className="text-xs text-link">
                Changes to permissions take effect immediately. Users will see updated access on
                their next page load.
              </span>
            </Callout>
          </div>
        </div>
      </BandCard>

      {asking ? (
        <Modal
          open
          title={`Give ${selected?.label ?? 'this role'} more than its default?`}
          onClose={() => setAsking(false)}
        >
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              Some boxes you ticked are not in this role&apos;s default permissions. Everyone with
              the role gets them on their next page load.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setAsking(false)}>
                Cancel
              </Button>
              <Button disabled={save.isPending} onClick={() => submit(true)}>
                Save Anyway
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
