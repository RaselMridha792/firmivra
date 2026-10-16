'use client';

import { CreateCustomRoleRequest, type MembershipRole } from '@firmivra/types';
import { Button, Callout, Input, PermissionMatrix, Select, Skeleton, Textarea } from '@firmivra/ui';
import { Info, ShieldPlus } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../../lib/query';
import {
  CAPABILITY_ORDER,
  MODULE_LOOKS,
  ROLE_ERRORS,
} from '../../../../../team/roles/_components/role-parts';
import { RoleTemplates } from '../../../../../team/roles/_components/role-side';
import {
  NOT_LOADED,
  Quiet,
  SettingsCard,
  SettingsHeader,
} from '../../../../_components/settings-parts';

const toValue = (cells: readonly { module: string; capability: string; granted: boolean }[]) => {
  const value: Record<string, string[]> = {};
  for (const c of cells) if (c.granted) (value[c.module] ??= []).push(c.capability);
  return value;
};

/**
 * Settings > Users & Roles > Create Custom Role (users-and-role.jpg Role Permissions and Module
 * Permissions, guide §5, §8): a name, a description and the role it starts from, with that role's
 * grid shown as the starting permissions. Saving sends `api.roles.createCustom`, which answers
 * 501 NOT_IMPLEMENTED until custom roles have their table (contract); the form keeps what was
 * typed and says so.
 */
export function NewRoleScreen() {
  const roles = useApiQuery(['roles', 'list'], () => api.roles.list());
  const modules = useApiQuery(['roles', 'modules'], () => api.roles.modules());
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [basedOn, setBasedOn] = useState<Exclude<MembershipRole, 'OWNER'>>('STAFF');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const grid = useApiQuery(['roles', 'permissions', basedOn], () => api.roles.permissions(basedOn));
  const create = useApiMutation(
    (body: Parameters<typeof api.roles.createCustom>[0]) => api.roles.createCustom(body),
    { invalidate: ['roles'] },
  );
  const choices = (roles.data?.items ?? []).filter((r) => r.role !== 'OWNER');

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
        className="grid grid-cols-1 items-start gap-4 min-[1800px]:grid-cols-[1fr_2fr]"
        onSubmit={(event) => {
          event.preventDefault();
          const body = { name: name.trim(), description: description.trim() || undefined, basedOn };
          const result = CreateCustomRoleRequest.safeParse(body);
          const found: Record<string, string> = {};
          if (!result.success) {
            for (const issue of result.error.issues) {
              const field = String(issue.path[0] ?? '');
              found[field] ??= field === 'name' ? 'Enter a role name.' : issue.message;
            }
          }
          setErrors(found);
          if (result.success) create.mutate(result.data);
        }}
      >
        <div className="flex min-w-0 flex-col gap-4">
          <SettingsCard title="Role Details" icon={ShieldPlus} testId="role-details">
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
                options={choices.map((r) => ({ value: r.role, label: r.label }))}
                value={basedOn}
                onChange={(e) => setBasedOn(e.target.value as Exclude<MembershipRole, 'OWNER'>)}
              />
            ) : roles.isPending ? (
              <Skeleton className="h-11" />
            ) : (
              <Quiet>{NOT_LOADED}</Quiet>
            )}
            {create.error ? (
              <Callout icon={Info} tone="amber" surface="warning" size="compact">
                {errorMessage(create.error, {
                  ...ROLE_ERRORS,
                  NOT_IMPLEMENTED:
                    'Custom roles are not available yet. What you typed stays on this page; use a role template for now.',
                })}
              </Callout>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Link
                href="/settings/users"
                className="inline-flex min-h-11 items-center rounded-control border border-action px-6 text-sm font-semibold text-action hover:bg-folder-surface"
              >
                Cancel
              </Link>
              <Button type="submit" className="ml-auto" disabled={create.isPending}>
                Create Role
              </Button>
            </div>
          </SettingsCard>
          {roles.data ? (
            <RoleTemplates
              roles={choices}
              selected={basedOn}
              canChange={false}
              onSelect={(r) => r.role !== 'OWNER' && setBasedOn(r.role)}
              onCreate={() => undefined}
            />
          ) : null}
        </div>

        <SettingsCard
          title="Starting Permissions"
          subtitle="The role you start from gives these. You change them on the role once it exists."
          icon={ShieldPlus}
          testId="starting-permissions"
        >
          {grid.data && modules.data ? (
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
        </SettingsCard>
      </form>
    </div>
  );
}
