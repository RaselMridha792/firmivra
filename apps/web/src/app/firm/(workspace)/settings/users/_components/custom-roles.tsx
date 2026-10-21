'use client';

import type {
  CustomRole,
  PermissionCell,
  PermissionGrant,
  RoleList,
  RolePermissions,
  RoleSummary,
} from '@firmivra/types';
import {
  Button,
  Callout,
  Modal,
  PermissionMatrix,
  type PermissionValue,
  Skeleton,
} from '@firmivra/ui';
import { Info } from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorCode, errorMessage } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';
import {
  CAPABILITY_ORDER,
  MODULE_LOOKS,
  NEEDS_VIEW,
  ROLE_ERRORS,
} from '../../../team/roles/_components/role-parts';
import { NOT_LOADED } from '../../_components/settings-parts';

/**
 * A role a selector offers (Users & Roles, Staff Management > Roles & Permissions): a built-in
 * role, or one of the firm's live custom roles (`custom:<id>`).
 */
export type RoleChoice =
  | { kind: 'role'; key: string; label: string; summary: RoleSummary }
  | { kind: 'custom'; key: string; label: string; custom: CustomRole };

export const customKey = (id: string) => `custom:${id}`;

/** The built-in roles, then the firm's live custom roles by name. */
export function roleChoices(list: RoleList | undefined): RoleChoice[] {
  return [
    ...(list?.items ?? []).map((summary): RoleChoice => ({
      kind: 'role',
      key: summary.role,
      label: summary.label,
      summary,
    })),
    ...(list?.custom ?? []).map((custom): RoleChoice => ({
      kind: 'custom',
      key: customKey(custom.id),
      label: `${custom.name} (custom)`,
      custom,
    })),
  ];
}

/** A role's grid: the built-in role's in this firm, or the custom role's own. */
export async function readGrid(choice: RoleChoice): Promise<RolePermissions> {
  if (choice.kind === 'role') return api.roles.permissions(choice.summary.role);
  const detail = await api.roles.customRole(choice.custom.id);
  return {
    role: detail.role.basedOn,
    cells: detail.cells,
    updatedAt: detail.role.updatedAt,
    updatedBy: detail.updatedBy,
  };
}

/** Save Changes for either kind (409 PERMISSION_ESCALATION: ask, then resend with `ack`). */
export async function saveGrid(
  choice: RoleChoice,
  grants: PermissionGrant[],
  ack: boolean,
): Promise<void> {
  if (choice.kind === 'role')
    await api.roles.savePermissions(choice.summary.role, { grants, acknowledgeEscalation: ack });
  else await api.roles.updateCustom(choice.custom.id, { grants, acknowledgeEscalation: ack });
}

/** The API's answers for custom roles in the screens' words. */
export const CUSTOM_ROLE_ERRORS: Record<string, string> = {
  ...ROLE_ERRORS,
  ROLE_NAME_TAKEN: 'A role with this name already exists. Choose another name.',
  CUSTOM_ROLE_IN_USE: 'People still have this role. Give them another role first, then archive it.',
  CUSTOM_ROLE_ARCHIVED: 'This role is archived and can no longer be changed or given.',
  CUSTOM_ROLE_MISMATCH: 'This custom role belongs to another role. Choose it again.',
};

const toValue = (cells: readonly PermissionCell[]): PermissionValue => {
  const value: Record<string, string[]> = {};
  for (const c of cells) if (c.granted) (value[c.module] ??= []).push(c.capability);
  return value;
};

/**
 * Set Permissions (Octavia's review, section 4 step 3: "Next or Create Role automatically opens a
 * Set Permissions dialog"): every module and capability, with the template's permissions in this
 * firm ticked. Save Role sends the role and the cells changed from the template together, so
 * Back or Cancel leaves no role behind. More than the template asks first ("Save Anyway").
 */
export function SetPermissionsModal({
  name,
  template,
  start,
  onSave,
  onBack,
  onSaved,
}: {
  name: string;
  /** The built-in role it starts from, by name. */
  template: string;
  /** The template's grid in this firm; undefined while it loads, null if it could not. */
  start: RolePermissions | null | undefined;
  onSave: (grants: PermissionGrant[], ack: boolean) => Promise<CustomRole>;
  onBack: () => void;
  onSaved: (role: CustomRole) => void;
}) {
  const modules = useApiQuery(['roles', 'modules'], () => api.roles.modules());
  const [draft, setDraft] = useState<PermissionValue | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const base = start ? toValue(start.cells) : {};
  const value = draft ?? base;

  const changed = (): PermissionGrant[] =>
    (start?.cells ?? []).flatMap((c) => {
      const now = value[c.module]?.includes(c.capability) ?? false;
      return now === c.granted
        ? []
        : [{ module: c.module, capability: c.capability, granted: now }];
    });

  const save = async (ack: boolean) => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await onSave(changed(), ack));
    } catch (e) {
      if (errorCode(e) === 'PERMISSION_ESCALATION') setAsking(true);
      else setError(e);
      setBusy(false);
    }
  };

  return (
    <Modal open title={`Set Permissions: ${name}`} onClose={onBack}>
      <div className="flex min-w-0 flex-col gap-4" data-testid="set-permissions">
        <p className="text-sm text-text">
          {name} starts with what {template} has in this firm. Tick or clear what it should have;{' '}
          {template} itself stays as it is.
        </p>
        <div className="max-h-[55vh] min-w-0 overflow-auto">
          {start && modules.data ? (
            <PermissionMatrix
              rows={modules.data.modules.map((m) => ({
                id: m.module,
                label: m.label,
                icon: MODULE_LOOKS[m.module][0],
                tone: MODULE_LOOKS[m.module][1],
              }))}
              columns={CAPABILITY_ORDER.map((c) => ({
                id: c,
                label: modules.data?.capabilities.find((x) => x.capability === c)?.label ?? c,
              }))}
              value={value}
              onChange={(next) => {
                setDraft(next);
                setAsking(false);
              }}
              rowHeader="Module / Page"
              fullAccess
              requires={NEEDS_VIEW}
              isAvailable={(row, column) =>
                modules.data?.modules
                  .find((m) => m.module === row)
                  ?.capabilities.some((c) => c === column) ?? false
              }
              caption={`Permissions for ${name}`}
            />
          ) : start === null || modules.isError ? (
            <PermissionMatrix rows={[]} columns={[]} value={{}} emptyText={NOT_LOADED} />
          ) : (
            <Skeleton className="h-80" />
          )}
        </div>
        {asking ? (
          <Callout icon={Info} tone="amber" surface="warning" size="compact">
            Some boxes give {name} more than {template} has in this firm. Everyone you give the role
            gets them. Save anyway?
          </Callout>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(error, CUSTOM_ROLE_ERRORS)}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-3">
          {draft ? (
            <button
              type="button"
              className="mr-auto text-sm text-link hover:underline"
              onClick={() => {
                setDraft(null);
                setAsking(false);
              }}
            >
              Back to {template}&apos;s permissions
            </button>
          ) : null}
          <Button variant="secondary" disabled={busy} onClick={onBack}>
            Back
          </Button>
          <Button disabled={!start || busy} onClick={() => void save(asking)}>
            {busy ? 'Saving…' : asking ? 'Save Anyway' : 'Save Role'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
