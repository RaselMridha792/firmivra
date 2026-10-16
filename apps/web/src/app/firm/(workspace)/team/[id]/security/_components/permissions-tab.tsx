'use client';

import {
  FIRM_ROLE_LABELS,
  type PermissionCell,
  type PermissionGrant,
  type PermissionModuleList,
} from '@firmivra/types';
import {
  Button,
  Callout,
  Modal,
  PermissionMatrix,
  type PermissionValue,
  Skeleton,
} from '@firmivra/ui';
import { Info, ListChecks, ShieldCheck } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../../../lib/api';
import { errorCode, errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { NOT_LOADED } from '../../../_components/quiet-card';
import { CAPABILITY_ORDER, MODULE_LOOKS, NEEDS_VIEW } from '../../../roles/_components/role-parts';
import { MEMBER_ERRORS, longDate } from '../../_components/staff-parts';
import { useMember } from '../../_components/use-member';
import { Panel } from './panel';
import { SecurityShell } from './security-shell';

const toValue = (cells: readonly { module: string; capability: string; granted: boolean }[]) => {
  const value: Record<string, string[]> = {};
  for (const c of cells) if (c.granted) (value[c.module] ??= []).push(c.capability);
  return value;
};

/** The whole grid as grants: the API keeps only the cells that differ from the role. */
function toGrants(value: PermissionValue, modules: PermissionModuleList): PermissionGrant[] {
  return modules.modules.flatMap((m) =>
    m.capabilities.map((capability) => ({
      module: m.module,
      capability,
      granted: (value[m.module] ?? []).includes(capability),
    })),
  );
}

const SOURCES: Record<PermissionCell['source'], string> = {
  ROLE_DEFAULT: 'Role default',
  FIRM_ROLE: 'Changed for the role in this firm',
  MEMBER: 'Changed for this person only',
};

/**
 * Permissions tab (guide §14): the member's effective permissions in the module grid, where they
 * come from, and Edit for this person only (`api.staff.setPermissions`). Giving more than the role
 * asks first (409 PERMISSION_ESCALATION, then acknowledgeEscalation).
 */
export function PermissionsTab({ id }: { id: string }) {
  const { member, manages } = useMember(id);
  const permissions = useApiQuery(['staff', 'permissions', id], () => api.staff.permissions(id));
  const modules = useApiQuery(['roles', 'modules'], () => api.roles.modules());
  const role = permissions.data?.role;
  const defaults = useApiQuery(['roles', 'permissions', role ?? 'none'], () =>
    role ? api.roles.permissions(role) : Promise.resolve(null),
  );
  const [draft, setDraft] = useState<PermissionValue | null>(null);
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState('');
  const save = useApiMutation(
    (body: { value: PermissionValue; ack?: boolean }) =>
      api.staff.setPermissions(id, {
        grants: modules.data ? toGrants(body.value, modules.data) : [],
        acknowledgeEscalation: body.ack,
      }),
    { invalidate: ['staff'] },
  );
  const cells = permissions.data?.cells ?? [];
  const value = draft ?? toValue(cells);
  const changes = cells.filter((c) => c.source === 'MEMBER');
  const label = (m: string) => modules.data?.modules.find((x) => x.module === m)?.label ?? m;
  const capability = (c: string) =>
    modules.data?.capabilities.find((x) => x.capability === c)?.label ?? c;
  const submit = (next: PermissionValue, ack?: boolean, message = 'Permissions saved.') =>
    save.mutate(
      { value: next, ack },
      {
        onSuccess: () => {
          setDraft(null);
          setAsking(false);
          setDone(message);
        },
        onError: (error) => {
          if (errorCode(error) === 'PERMISSION_ESCALATION') setAsking(true);
        },
      },
    );
  const failed = permissions.isError || modules.isError;
  const saveError =
    save.error && errorCode(save.error) !== 'PERMISSION_ESCALATION' ? save.error : null;

  return (
    <SecurityShell id={id} tab="permissions">
      <div className="grid grid-cols-1 items-start gap-4 min-[1440px]:grid-cols-3">
        <Panel
          title="Effective Permissions"
          subtitle="What this person can do in each module: their role’s permissions and any changes for them."
          icon={ShieldCheck}
          testId="effective-permissions"
          className="min-[1440px]:col-span-2"
          action={
            draft ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                <Button disabled={save.isPending} onClick={() => submit(draft)}>
                  Save Changes
                </Button>
              </div>
            ) : (
              <Button
                variant="secondary"
                disabled={!manages || !permissions.data || !modules.data}
                onClick={() => {
                  setDone('');
                  setDraft(toValue(cells));
                }}
              >
                Edit Permissions
              </Button>
            )
          }
        >
          {permissions.data ? (
            <p className="text-sm text-muted" data-testid="permissions-summary">
              Role:{' '}
              <span className="font-semibold text-heading">
                {FIRM_ROLE_LABELS[permissions.data.role]}
              </span>
              {' · '}
              {changes.length
                ? `${changes.length} change${changes.length === 1 ? '' : 's'} for this person`
                : 'No changes for this person'}
              {permissions.data.updatedAt
                ? ` · Updated ${longDate(permissions.data.updatedAt)}`
                : ''}
            </p>
          ) : null}
          {permissions.isPending || modules.isPending ? (
            <Skeleton className="h-96" />
          ) : failed || !modules.data ? (
            <PermissionMatrix rows={[]} columns={[]} value={{}} emptyText={NOT_LOADED} />
          ) : (
            <PermissionMatrix
              rows={modules.data.modules.map((m) => ({
                id: m.module,
                label: m.label,
                icon: MODULE_LOOKS[m.module][0],
                tone: MODULE_LOOKS[m.module][1],
              }))}
              columns={CAPABILITY_ORDER.map((c) => ({ id: c, label: capability(c) }))}
              value={value}
              readOnly={!draft}
              onChange={draft ? setDraft : undefined}
              rowHeader="Module / Page"
              fullAccess={Boolean(draft)}
              requires={NEEDS_VIEW}
              isAvailable={(row, column) =>
                modules.data?.modules
                  .find((m) => m.module === row)
                  ?.capabilities.some((c) => c === column) ?? false
              }
              caption={`Permissions for ${member?.name ?? 'this staff member'}`}
            />
          )}
          {saveError ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(saveError, MEMBER_ERRORS)}
            </p>
          ) : done ? (
            <p role="status" data-testid="permissions-result" className="text-sm text-success">
              {done}
            </p>
          ) : null}
        </Panel>

        <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2 min-[1440px]:grid-cols-1">
          <Panel
            title="Changes for This Person"
            icon={ListChecks}
            testId="permission-changes"
            action={
              <Button
                variant="ghost"
                disabled={!manages || !changes.length || !defaults.data || save.isPending}
                onClick={() => {
                  if (defaults.data) {
                    submit(toValue(defaults.data.cells), false, 'Back to the role’s permissions.');
                  }
                }}
              >
                Reset to Role
              </Button>
            }
          >
            {permissions.isPending ? (
              <Skeleton className="h-20" />
            ) : permissions.isError ? (
              <p className="rounded-lg bg-subtle p-4 text-sm text-muted">{NOT_LOADED}</p>
            ) : changes.length ? (
              <ul className="flex flex-col divide-y divide-divider">
                {changes.map((c) => (
                  <li
                    key={`${c.module}:${c.capability}`}
                    className="flex items-center justify-between gap-3 py-2 text-sm"
                  >
                    <span className="text-heading">
                      {label(c.module)}: {capability(c.capability)}
                    </span>
                    <span className={c.granted ? 'text-success' : 'text-danger'}>
                      {c.granted ? 'Added' : 'Removed'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg bg-subtle p-4 text-sm text-muted">
                This person has exactly their role’s permissions.
              </p>
            )}
          </Panel>
          <Callout
            icon={Info}
            tone="navy"
            surface="plain"
            size="compact"
            title="Where permissions come from"
          >
            <ul className="flex flex-col gap-1">
              {Object.values(SOURCES).map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            <p className="mt-2">
              Change the role itself in{' '}
              <Link href="/team/roles" className="font-semibold text-link hover:underline">
                Roles &amp; Permissions
              </Link>
              , or give this person another role in{' '}
              <Link href={`/team/${id}`} className="font-semibold text-link hover:underline">
                Edit Staff
              </Link>
              .
            </p>
          </Callout>
        </div>
      </div>

      {asking && draft ? (
        <Modal open title="Give more than the role allows?" onClose={() => setAsking(false)}>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              Some boxes you ticked are not in this person’s role. Only this person gets them, and
              the change is recorded in the audit log.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setAsking(false)}>
                Cancel
              </Button>
              <Button disabled={save.isPending} onClick={() => submit(draft, true)}>
                Save Anyway
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </SecurityShell>
  );
}
