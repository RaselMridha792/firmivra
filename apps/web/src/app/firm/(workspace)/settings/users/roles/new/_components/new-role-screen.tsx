'use client';

import { CreateCustomRoleRequest, FIRM_ROLE_LABELS, MembershipRole } from '@firmivra/types';
import { Button, Input, PermissionMatrix, Select, Skeleton, Textarea } from '@firmivra/ui';
import { ShieldPlus } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../../../../lib/api';
import { errorCode } from '../../../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../../../lib/query';
import {
  BandCard,
  NOT_LOADED,
  Quiet,
  SettingsHeader,
} from '../../../../_components/settings-parts';
import {
  CUSTOM_ROLE_ERRORS,
  customKey,
  readGrid,
  SetPermissionsModal,
} from '../../../_components/custom-roles';
import { COLUMNS } from '../../../_components/role-panel';
import { RoleTemplates } from '../../../_components/role-templates';

const toValue = (cells: readonly { module: string; capability: string; granted: boolean }[]) => {
  const value: Record<string, string[]> = {};
  for (const c of cells) if (c.granted) (value[c.module] ??= []).push(c.capability);
  return value;
};

/**
 * Settings > Users & Roles > Create Custom Role (users-and-role.jpg Role Permissions and Module
 * Permissions, guide §5, §8; Octavia's review, section 4): a name, a description and the role it
 * starts from, with that role's grid shown as the starting permissions. Next opens Set
 * Permissions; Save Role there creates the role and its grid together (`api.roles.createCustom`),
 * then Users & Roles shows it. `from` is the template chosen on Users & Roles (`?from=BOOKKEEPER`,
 * or `?from=custom:<id>` for a custom role: its permissions are the start, and the new role is
 * based on the same built-in role).
 */
export function NewRoleScreen({ from }: { from?: string }) {
  const roles = useApiQuery(['roles', 'list'], () => api.roles.list());
  const modules = useApiQuery(['roles', 'modules'], () => api.roles.modules());
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const given = MembershipRole.safeParse(from);
  /** A built-in role, or `custom:<id>`. */
  const [startKey, setStartKey] = useState<string>(
    from?.startsWith('custom:')
      ? from
      : given.success && given.data !== 'OWNER'
        ? given.data
        : 'STAFF',
  );
  const customStart = roles.data?.custom?.find((c) => customKey(c.id) === startKey);
  const fromCustom = startKey.startsWith('custom:');
  // A custom role that is gone (archived) falls back to Staff once the roles are known.
  const basedOn = (customStart?.basedOn ?? (fromCustom ? 'STAFF' : startKey)) as Exclude<
    MembershipRole,
    'OWNER'
  >;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [setting, setSetting] = useState(false);
  const router = useRouter();
  const queryClient = useQueryClient();
  const base = useApiQuery(['roles', 'permissions', basedOn], () => api.roles.permissions(basedOn));
  const grid = useApiQuery(['roles', 'permissions', customStart ? startKey : basedOn], () =>
    customStart
      ? readGrid({
          kind: 'custom',
          key: startKey,
          label: customStart.name,
          custom: customStart,
        })
      : api.roles.permissions(basedOn),
  );
  const templateName = customStart?.name ?? FIRM_ROLE_LABELS[basedOn];
  const choices = (roles.data?.items ?? []).filter((r) => r.role !== 'OWNER');
  /** A built-in role's name or a live custom role's, in any case (the API checks again). */
  const taken = (wanted: string) =>
    [
      ...(roles.data?.items ?? []).map((r) => r.label),
      ...(roles.data?.custom ?? []).map((r) => r.name),
    ].some((n) => n.toLowerCase() === wanted.toLowerCase());
  const body = { name: name.trim(), description: description.trim() || undefined, basedOn };
  const nameTaken = CUSTOM_ROLE_ERRORS['ROLE_NAME_TAKEN'] ?? 'Choose another name.';

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <SettingsHeader
        icon={ShieldPlus}
        title="Create Custom Role"
        subtitle="Start from a role, name it, and give it the permissions your firm needs."
      />
      <form
        noValidate
        aria-label="Create custom role"
        className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          const result = CreateCustomRoleRequest.safeParse(body);
          const found: Record<string, string> = {};
          if (!result.success) {
            for (const issue of result.error.issues) {
              const field = String(issue.path[0] ?? '');
              found[field] ??= field === 'name' ? 'Enter a role name.' : issue.message;
            }
          } else if (taken(body.name)) {
            found['name'] = nameTaken;
          }
          setErrors(found);
          if (!Object.keys(found).length) setSetting(true);
        }}
      >
        <BandCard title="Role Details" testId="role-details" className="self-stretch">
          <div className="flex flex-1 flex-col gap-4 p-4">
            <Input
              label="Role Name *"
              placeholder="For example Payroll Specialist"
              maxLength={60}
              value={name}
              error={errors.name}
              onChange={(e) => setName(e.target.value)}
            />
            <Textarea
              label="Description"
              rows={3}
              maxLength={300}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            {roles.data ? (
              <Select
                label="Start From *"
                options={[
                  ...choices.map((r) => ({ value: r.role, label: r.label })),
                  ...(roles.data.custom ?? []).map((c) => ({
                    value: customKey(c.id),
                    label: `${c.name} (custom)`,
                  })),
                ]}
                value={customStart || !fromCustom ? startKey : basedOn}
                onChange={(e) => setStartKey(e.target.value)}
              />
            ) : roles.isPending ? (
              <Skeleton className="h-11" />
            ) : (
              <Quiet>{NOT_LOADED}</Quiet>
            )}
            <div className="flex flex-wrap gap-3">
              <Link
                href="/settings/users"
                className="inline-flex min-h-11 items-center rounded-control border border-action px-6 text-sm font-semibold text-action hover:bg-folder-surface"
              >
                Cancel
              </Link>
              <Button type="submit" className="ml-auto" disabled={!roles.data}>
                Next: Set Permissions
              </Button>
            </div>
          </div>
        </BandCard>
        <RoleTemplates
          roles={roles.data ? choices : undefined}
          custom={roles.data?.custom}
          loading={roles.isPending}
          selected={customStart ? startKey : basedOn}
          canChange
          onUse={(r) => r !== 'OWNER' && setStartKey(r)}
        />

        <BandCard
          title="Starting Permissions"
          testId="starting-permissions"
          className="lg:col-span-2"
        >
          <div className="flex flex-col gap-3 p-4 pt-2">
            <p className="text-sm text-text">
              The role you start from gives these. You change them in the next step, Set
              Permissions.
            </p>
            {grid.data && modules.data ? (
              <PermissionMatrix
                rows={modules.data.modules.map((m) => ({ id: m.module, label: m.label }))}
                columns={COLUMNS.map(([id, label]) => ({ id, label }))}
                value={toValue(grid.data.cells)}
                readOnly
                rowHeader="Module"
                isAvailable={(row, column) =>
                  modules.data?.modules
                    .find((m) => m.module === row)
                    ?.capabilities.some((c) => c === column) ?? false
                }
                caption="Starting permissions for the new role"
              />
            ) : grid.isError || modules.isError ? (
              <PermissionMatrix rows={[]} columns={[]} value={{}} emptyText={NOT_LOADED} />
            ) : (
              <Skeleton className="h-80" />
            )}
          </div>
        </BandCard>
      </form>
      {setting ? (
        <SetPermissionsModal
          name={body.name}
          template={templateName}
          start={grid.isError ? null : grid.data}
          base={base.isError ? null : base.data}
          baseName={FIRM_ROLE_LABELS[basedOn]}
          onSave={async (grants, ack) => {
            try {
              return await api.roles.createCustom({ ...body, grants, acknowledgeEscalation: ack });
            } catch (e) {
              // A name someone took meanwhile goes back to the name field.
              if (errorCode(e) === 'ROLE_NAME_TAKEN') {
                setErrors({ name: nameTaken });
                setSetting(false);
              }
              throw e;
            }
          }}
          onBack={() => setSetting(false)}
          onSaved={(role) => {
            void queryClient.invalidateQueries({ queryKey: ['roles'] });
            void queryClient.invalidateQueries({ queryKey: ['users'] });
            void queryClient.invalidateQueries({ queryKey: ['staff', 'options'] });
            router.push(`/settings/users?role=${encodeURIComponent(customKey(role.id))}`);
          }}
        />
      ) : null}
    </div>
  );
}
