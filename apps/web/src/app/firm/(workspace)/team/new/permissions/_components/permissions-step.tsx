'use client';

import type {
  MembershipRole,
  PermissionCapability,
  PermissionCell,
  PermissionGrant,
  PermissionModuleList,
  StaffDraftData,
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
} from '@firmivra/ui';
import {
  ArrowCounterClockwise,
  ArrowSquareOut,
  Copy,
  Eraser,
  FileText,
  Info,
  Lightning,
  Question,
  ShieldCheck,
  UsersThree,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { NOT_LOADED } from '../../../_components/quiet-card';
import { CAPABILITY_ORDER, MODULE_LOOKS, NEEDS_VIEW } from '../../../roles/_components/role-parts';
import { MultiPick } from '../../_components/multi-pick';
import { SectionCard } from '../../_components/section-card';
import { StepActions, WithDraft, useDraftSaver } from '../../_components/with-draft';
import { WizardHeader } from '../../_components/wizard-header';
import { STAFF_ERRORS, stepHref } from '../../_components/wizard-parts';

/** Create Staff's grid has the design's six columns; Export follows the role's default. */
const COLUMNS: PermissionCapability[] = CAPABILITY_ORDER.filter((c) => c !== 'EXPORT');

const toValue = (cells: readonly { module: string; capability: string; granted: boolean }[]) => {
  const value: Record<string, string[]> = {};
  for (const c of cells) if (c.granted) (value[c.module] ??= []).push(c.capability);
  return value;
};

function toGrants(value: PermissionValue, modules: PermissionModuleList): PermissionGrant[] {
  return modules.modules.flatMap((m) =>
    m.capabilities
      .filter((c) => COLUMNS.includes(c))
      .map((capability) => ({
        module: m.module,
        capability,
        granted: (value[m.module] ?? []).includes(capability),
      })),
  );
}

const card = 'rounded-xl border border-divider bg-surface p-4 shadow-sm';

/**
 * Create Staff, step 2 (create-staff-2.jpg, guide §4-6): the role with its description and the
 * Module Permissions grid, starting from the role's defaults (`api.roles.permissions`). Quick
 * Presets put the defaults back, copy another active member's grid (read before the account
 * exists, as the contract says) or clear every box. Everything stays in the draft.
 */
export function PermissionsStep({ draftId }: { draftId?: string }) {
  return (
    <WithDraft draftId={draftId} step="permissions">
      {(state) => <PermissionsForm {...state} />}
    </WithDraft>
  );
}

function PermissionsForm({
  draftId: startDraft,
  base,
  notice,
}: {
  draftId: string | null;
  base: StaffDraftData;
  notice?: string;
}) {
  const router = useRouter();
  const options = useApiQuery(['staff', 'options'], () => api.staff.options());
  const modules = useApiQuery(['roles', 'modules'], () => api.roles.modules());
  const o = options.data;
  const [role, setRole] = useState<MembershipRole | ''>(base.account?.role ?? '');
  const [departmentIds, setDepartmentIds] = useState<string[]>(base.account?.departmentIds ?? []);
  const [jobTitle, setJobTitle] = useState(base.account?.jobTitle ?? '');
  // null: the role's defaults; a value: the boxes as changed here (or copied, or cleared).
  const [grid, setGrid] = useState<PermissionValue | null>(() =>
    base.permissions ? toValue(base.permissions) : null,
  );
  const [roleError, setRoleError] = useState('');
  const [dialog, setDialog] = useState<'copy' | 'clear' | null>(null);
  const defaults = useApiQuery(['roles', 'permissions', role || 'none'], () =>
    role ? api.roles.permissions(role) : Promise.resolve(null),
  );
  const draft = useDraftSaver(startDraft, 2);
  const value = grid ?? (defaults.data ? toValue(defaults.data.cells) : {});
  const change = (next: PermissionValue | null) => {
    setGrid(next);
    draft.touched();
  };

  const data = (): StaffDraftData => ({
    ...base,
    account: {
      ...base.account,
      ...(role ? { role } : {}),
      ...(departmentIds.length ? { departmentIds } : {}),
      ...(jobTitle.trim() ? { jobTitle: jobTitle.trim() } : {}),
    },
    permissions: grid && modules.data ? toGrants(grid, modules.data) : base.permissions,
  });
  const go = (step: 'account' | 'security', check: boolean) => {
    if (check && !role) {
      setRoleError('Choose a role.');
      return;
    }
    setRoleError('');
    draft.save(data(), (id) => router.push(stepHref(step, id)));
  };

  const chosen = o?.roles.find((r) => r.role === role);
  const gridFailed = modules.isError || (role !== '' && grid === null && defaults.isError);
  const gridLoading = modules.isPending || (role !== '' && grid === null && defaults.isPending);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <WizardHeader step="permissions" />
      {notice ? (
        <Callout icon={Info} tone="navy" surface="plain" size="compact">
          {notice}
        </Callout>
      ) : null}
      {/* The design's two-to-one split from 1440 px; narrower, the side cards go under. */}
      <div className="grid grid-cols-1 items-start gap-4 min-[1440px]:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 min-[1440px]:col-span-2">
          <SectionCard
            id="role-permissions"
            number={2}
            title="Role & Permissions"
            subtitle="Select a role and customize permissions for this staff member."
            icon={ShieldCheck}
          >
            {options.isError ? (
              <Callout icon={Info} tone="navy" surface="plain" size="compact">
                The choices could not be loaded right now. They fill in once the data is available.
              </Callout>
            ) : null}
            <div className="grid gap-4 md:grid-cols-3">
              <div className="flex min-w-0 flex-col gap-1">
                <Select
                  label="Select a Role *"
                  options={[
                    { value: '', label: 'Select a role' },
                    ...(o?.roles ?? []).map((r) => ({ value: r.role, label: r.label })),
                  ]}
                  value={role}
                  error={roleError}
                  onChange={(e) => {
                    setRole(e.target.value as MembershipRole | '');
                    // A new role starts from its own defaults (guide §4).
                    change(null);
                  }}
                />
                <p className="text-xs text-muted">
                  Roles provide a set of default permissions. You can customize them below.
                </p>
              </div>
              <MultiPick
                label="Department(s)"
                placeholder="Select department(s)"
                options={(o?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))}
                value={departmentIds}
                emptyText="No departments yet. Add one in Teams & Departments."
                onChange={(v) => {
                  setDepartmentIds(v);
                  draft.touched();
                }}
              />
              <div className="flex min-w-0 flex-col gap-1">
                <Input
                  label="Job Title"
                  list="step2-job-titles"
                  maxLength={100}
                  placeholder="Select or enter job title"
                  value={jobTitle}
                  onChange={(e) => {
                    setJobTitle(e.target.value);
                    draft.touched();
                  }}
                />
                <datalist id="step2-job-titles">
                  {(o?.jobTitles ?? []).map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>
            </div>
          </SectionCard>

          <section aria-labelledby="module-permissions" className={`min-w-0 ${card}`}>
            <h2 id="module-permissions" className="text-xl font-bold text-heading">
              Module Permissions
            </h2>
            <p className="mb-3 text-sm text-muted">
              Select which areas this staff member can access and what they can do.
            </p>
            {gridLoading ? (
              <Skeleton className="h-96" />
            ) : gridFailed || !modules.data ? (
              <PermissionMatrix rows={[]} columns={[]} value={{}} emptyText={NOT_LOADED} />
            ) : !role ? (
              <PermissionMatrix
                rows={[]}
                columns={[]}
                value={{}}
                emptyText="Choose a role to see its permissions here."
              />
            ) : (
              <PermissionMatrix
                rows={modules.data.modules.map((m) => ({
                  id: m.module,
                  label: m.label,
                  icon: MODULE_LOOKS[m.module][0],
                  tone: MODULE_LOOKS[m.module][1],
                }))}
                columns={COLUMNS.map((c) => ({
                  id: c,
                  label: modules.data?.capabilities.find((x) => x.capability === c)?.label ?? c,
                }))}
                value={value}
                onChange={(next) => change(next)}
                rowHeader="Module / Page"
                fullAccess
                requires={NEEDS_VIEW}
                isAvailable={(row, column) =>
                  modules.data?.modules
                    .find((m) => m.module === row)
                    ?.capabilities.some((c) => c === column) ?? false
                }
                caption="Module permissions for this staff member"
              />
            )}
          </section>

          <StepActions
            nextLabel="Next: Access & Security"
            pending={draft.pending}
            saved={draft.saved}
            error={draft.error}
            onBack={() => go('account', false)}
            onSave={() =>
              draft.save(data(), (id) =>
                router.replace(stepHref('permissions', id), { scroll: false }),
              )
            }
            onNext={() => go('security', true)}
          />
        </div>

        <aside className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2 min-[1440px]:grid-cols-1">
          <section aria-label="Role description" data-testid="role-description" className={card}>
            <div className="flex items-start gap-4">
              <span
                aria-hidden
                className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-info-soft text-heading"
              >
                <UsersThree weight="fill" className="size-8" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-heading">Role Description</p>
                {chosen ? (
                  <>
                    <p className="text-xl font-bold text-heading">{chosen.label}</p>
                    <p className="mt-1 text-sm text-link">{chosen.description}</p>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-muted">
                    {options.isError ? NOT_LOADED : 'Choose a role to see what it allows.'}
                  </p>
                )}
              </div>
            </div>
          </section>

          <section aria-labelledby="quick-presets" className={card}>
            <h2 id="quick-presets" className="mb-3 flex items-center gap-3 text-base font-bold">
              <span
                aria-hidden
                className="flex size-10 items-center justify-center rounded-lg bg-info-soft text-heading"
              >
                <Lightning weight="fill" className="size-5" />
              </span>
              <span className="text-heading">Quick Presets</span>
            </h2>
            <div className="flex flex-col gap-3">
              <Button variant="secondary" disabled={!role} onClick={() => change(null)}>
                <ArrowCounterClockwise aria-hidden weight="bold" className="size-4" />
                Apply Default Permissions for This Role
              </Button>
              <Button
                variant="secondary"
                disabled={!role || !modules.data}
                onClick={() => setDialog('copy')}
              >
                <Copy aria-hidden weight="bold" className="size-4" />
                Copy Permissions from Another Staff Member
              </Button>
              <Button
                variant="secondary"
                disabled={!role || !modules.data}
                onClick={() => setDialog('clear')}
              >
                <Eraser aria-hidden weight="bold" className="size-4" />
                Clear All Permissions
              </Button>
            </div>
          </section>

          <Callout
            icon={FileText}
            iconStyle="tile"
            tone="blue"
            surface="plain"
            title="Permission Notes"
          >
            Permissions control what this staff member can see and do in LVP. For sensitive areas
            (e.g., Settings, Staff Management), additional approval may be required.
          </Callout>
          <Callout
            icon={Question}
            tone="navy"
            surface="plain"
            title="Need Help?"
            action={
              <Link
                href="/team"
                className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-action bg-surface text-sm font-semibold text-action hover:bg-folder-surface"
              >
                <ArrowSquareOut aria-hidden weight="bold" className="size-4" />
                View Guide
              </Link>
            }
          >
            Check out our Staff Management Guide or contact support.
          </Callout>
        </aside>
      </div>

      {dialog === 'copy' ? (
        <CopyModal
          people={o?.managers ?? []}
          onClose={() => setDialog(null)}
          onCopy={(cells) => {
            change(toValue(cells));
            setDialog(null);
          }}
        />
      ) : null}
      {dialog === 'clear' ? (
        <Modal open title="Clear all permissions?" onClose={() => setDialog(null)}>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              Every box turns off. Nothing is kept until you save the draft or go on.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  change({});
                  setDialog(null);
                }}
              >
                Clear All
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

/**
 * Copy Permissions from Another Staff Member: choose an active member and copy their whole grid
 * (`api.staff.permissions`). The account does not exist yet, so their grid is read and copied
 * here; nothing changes for them.
 */
function CopyModal({
  people,
  onClose,
  onCopy,
}: {
  people: { id: string; name: string; jobTitle: string | null }[];
  onClose: () => void;
  onCopy: (cells: PermissionCell[]) => void;
}) {
  const [personId, setPersonId] = useState('');
  const [missing, setMissing] = useState('');
  const read = useApiMutation((id: string) => api.staff.permissions(id));
  return (
    <Modal
      open
      title="Copy Permissions from Another Staff Member"
      subtitle="Their grid replaces the boxes shown; nothing changes for them."
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <Select
          label="Staff member *"
          options={[
            { value: '', label: 'Choose a staff member' },
            ...people.map((p) => ({
              value: p.id,
              label: p.jobTitle ? `${p.name}, ${p.jobTitle}` : p.name,
            })),
          ]}
          value={personId}
          error={missing}
          onChange={(e) => setPersonId(e.target.value)}
        />
        {read.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(read.error, STAFF_ERRORS)}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={read.isPending}
            onClick={() => {
              if (!personId) {
                setMissing('Choose a staff member.');
                return;
              }
              read.mutate(personId, { onSuccess: (res) => onCopy(res.cells) });
            }}
          >
            Copy Permissions
          </Button>
        </div>
      </div>
    </Modal>
  );
}
