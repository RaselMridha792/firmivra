'use client';

import { Info, LockSimple, Warning } from '@phosphor-icons/react';
import { Badge, Button, Callout, Card, Input, Modal, Select, Skeleton } from '@firmivra/ui';
import Link from 'next/link';
import { useState, type FormEvent, type ReactNode } from 'react';
import { errorCode } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';
import { AccessPermissions } from './access-permissions';
import {
  ACCESS_LEVELS,
  ACCESS_SCOPES,
  accessLevelOf,
  adminTeam,
  type AdminTeamMember,
  AUTHORITY_LEVELS,
  blankMember,
  checkMember,
  errorMessage,
  fieldErrorsOf,
  type FormRole,
  grantable,
  MEMBER_STATUSES,
  type MemberFieldErrors,
  type MemberFormOptions,
  memberToSave,
  roleById,
  roleDefaultScope,
  roleTemplate,
  samePermissions,
  type SaveTeamMember,
  supervisorsFor,
  TEAM_ERROR_MESSAGES,
  type TeamPermissions,
  teamModules,
} from './team-api';
import { ButtonLink, TEAM_KEY } from './team-parts';

/** "Team / Add Team Member" above the title. */
export function TeamBreadcrumb({ current }: { current: string }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <li>
          <Link href="/team" className="text-link hover:underline">
            Team
          </Link>
        </li>
        <li aria-hidden>/</li>
        <li aria-current="page" className="text-text">
          {current}
        </li>
      </ol>
    </nav>
  );
}

/** The form card (two thirds) and the side cards at 1440 px; one column on a phone. */
export function FormLayout({ form, aside }: { form: ReactNode; aside: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-5 xl:grid-cols-3 xl:items-start">
      <Card variant="elevated" className="min-w-0 !p-6 xl:col-span-2">
        {form}
      </Card>
      <div className="flex min-w-0 flex-col gap-5">{aside}</div>
    </div>
  );
}

/** The frames while the choices load. */
export function FormSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-5">
      <span className="sr-only">Loading…</span>
      {['a', 'b', 'c', 'd'].map((key) => (
        <div key={key} className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-11" />
          <Skeleton className="h-11" />
        </div>
      ))}
      <Skeleton className="h-48" />
    </div>
  );
}

export function SideCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card variant="elevated" className="!p-5">
      <h2 className="mb-3 text-lg font-semibold text-heading">{title}</h2>
      {children}
    </Card>
  );
}

function ReviewRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-divider py-2 last:border-0">
      <dt className="text-xs font-medium tracking-wide text-muted uppercase">{label}</dt>
      <dd className="text-sm wrap-anywhere text-text">{children}</dd>
    </div>
  );
}

/** One checkbox with a bold line and a smaller description (the design's Send Invitation). */
function CheckLine({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-5 shrink-0"
      />
      <span className="flex flex-col">
        <span className="text-base text-text">{label}</span>
        <span className="text-sm text-muted">{description}</span>
      </span>
    </label>
  );
}

const byLevel = (a: FormRole, b: FormRole) => a.level - b.level || a.title.localeCompare(b.title);

/** Nothing to choose from: the frame's choices when the form's data could not load. */
const NO_OPTIONS: MemberFormOptions = {
  departments: [],
  departmentLocked: false,
  roles: [],
  supervisors: [],
  locations: [],
  teams: [],
  scopes: [],
  viewerPermissions: {},
  unrestricted: false,
  canCustomize: false,
  statuses: [],
};

/**
 * The form's frame when its data could not load: every section with empty, disabled fields, the
 * module grid unchecked and the submit button disabled, under the quiet line that Review repeats.
 */
export function MemberFormFrame({
  mode,
  message,
  testId,
  aside,
}: {
  mode: 'create' | 'edit';
  message: string;
  testId: string;
  /** Extra side cards under Review (the edit page's activity). */
  aside?: ReactNode;
}) {
  return (
    <MemberForm
      mode={mode}
      options={NO_OPTIONS}
      unavailable={{ message, testId }}
      aside={aside}
      onSaved={() => undefined}
    />
  );
}

/**
 * The one Add / Edit Team Member form (creating-team docx §4, §21, §24). Every choice comes from
 * `options`, which the API cuts to the signed-in admin's authority: a lower level sees fewer
 * departments, roles, scopes and permissions, and the API checks the same rules again on save.
 */
export function MemberForm({
  mode,
  options,
  member,
  aside,
  unavailable,
  onSaved,
}: {
  mode: 'create' | 'edit';
  options: MemberFormOptions;
  member?: AdminTeamMember;
  /** Extra side cards under Review (the edit page's activity). */
  aside?: ReactNode;
  /** The form's data could not load: this line tops the form and fills Review; nothing is editable. */
  unavailable?: { message: string; testId: string };
  onSaved: (saved: AdminTeamMember) => void;
}) {
  const disabled = Boolean(unavailable);
  const [values, setValues] = useState<SaveTeamMember>(() => {
    if (member) return memberToSave(member);
    const blank = blankMember();
    if (disabled) return { ...blank, status: '', invite: { email: false, sms: false } };
    const only = options.departments.length === 1 ? options.departments[0]?.id : undefined;
    return only ? { ...blank, departmentId: only } : blank;
  });
  const [errors, setErrors] = useState<MemberFieldErrors>({});
  const [problem, setProblem] = useState('');
  const [lastRoleId, setLastRoleId] = useState(member?.roleId ?? '');
  const [pendingRole, setPendingRole] = useState<FormRole | null>(null);
  const save = useApiMutation(
    (body: SaveTeamMember) =>
      member ? adminTeam.updateMember(member.id, body) : adminTeam.createMember(body),
    { invalidate: TEAM_KEY },
  );

  const self = Boolean(member?.isYou);
  const lockRole = disabled || self || (member ? !member.allowed.changeRole : false);
  const lockStatus = disabled || self || (member ? !member.allowed.changeStatus : false);
  const lockDepartment = lockRole || (mode === 'create' && options.departmentLocked);
  const lockPermissions = self || lockRole || !options.canCustomize;

  const roles = options.roles
    .filter((role) => role.departmentId === values.departmentId)
    .sort(byLevel);
  const role = options.roles.find((entry) => entry.id === values.roleId);
  const supervisors = role
    ? supervisorsFor(options.supervisors, values.departmentId, role.level)
    : [];
  const teams = options.teams.filter((team) => team.departmentId === values.departmentId);
  const template: TeamPermissions = values.roleId ? roleTemplate(values.roleId) : {};
  // The frame lists every module as it is (unchecked and disabled), not as out of reach.
  const ceiling = values.roleId
    ? grantable(values.roleId, options.viewerPermissions, options.unrestricted)
    : options.unrestricted || disabled
      ? grantable('ceo', {}, true)
      : options.viewerPermissions;
  const custom = Boolean(values.roleId) && !samePermissions(values.permissions, template);
  const modules = teamModules();
  const moduleCount = modules.filter((area) => values.permissions[area.id]?.length).length;

  const change = (patch: Partial<SaveTeamMember>) => {
    setValues({ ...values, ...patch });
    const cleared = { ...errors };
    for (const key of Object.keys(patch) as (keyof SaveTeamMember)[]) delete cleared[key];
    setErrors(cleared);
    setProblem('');
  };

  /** The closest valid supervisor above the role in its department, else the CEO. */
  function defaultSupervisor(next: FormRole): string {
    const valid = supervisorsFor(options.supervisors, next.departmentId, next.level);
    if (valid.some((person) => person.id === values.reportsToId)) return values.reportsToId;
    const inDepartment = valid
      .filter((person) => person.departmentId === next.departmentId)
      .sort((a, b) => b.level - a.level);
    return inDepartment[0]?.id ?? valid[0]?.id ?? '';
  }

  function applyRole(next: FormRole, loadTemplate: boolean) {
    const previous = roleById(values.roleId || lastRoleId);
    // The role's own default scope on the API; the mock's comes from the level.
    const oldDefault = previous ? roleDefaultScope(previous.id) : undefined;
    const newDefault = roleDefaultScope(next.id);
    const keepScope =
      values.scope && values.scope !== oldDefault && options.scopes.includes(values.scope);
    change({
      roleId: next.id,
      jobTitle:
        !values.jobTitle.trim() || values.jobTitle === previous?.title
          ? next.title
          : values.jobTitle,
      permissions: loadTemplate ? roleTemplate(next.id) : values.permissions,
      scope: keepScope
        ? values.scope
        : newDefault && options.scopes.includes(newDefault)
          ? newDefault
          : '',
      reportsToId: defaultSupervisor(next),
    });
    setLastRoleId(next.id);
  }

  function chooseRole(id: string) {
    const next = options.roles.find((entry) => entry.id === id);
    if (!next) return change({ roleId: '' });
    const previous = values.roleId || lastRoleId;
    const customized =
      Boolean(previous) &&
      modules.some((area) => values.permissions[area.id]?.length) &&
      !samePermissions(values.permissions, roleTemplate(previous));
    // Docx §21: warn before a new role's template replaces custom access.
    if (mode === 'edit' && customized) setPendingRole(next);
    else applyRole(next, true);
  }

  function chooseDepartment(id: string) {
    const keepRole = roleById(values.roleId)?.departmentId === id;
    const keepTeam = options.teams.some(
      (team) => team.id === values.teamId && team.departmentId === id,
    );
    change({
      departmentId: id,
      roleId: keepRole ? values.roleId : '',
      teamId: keepTeam ? values.teamId : '',
      reportsToId: keepRole ? values.reportsToId : '',
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    const found = checkMember(values, mode);
    setErrors(found);
    if (Object.values(found).some(Boolean)) {
      setProblem('Some details need fixing. Check the highlighted fields.');
      return;
    }
    save.mutate(values, {
      onSuccess: onSaved,
      onError: (error) => {
        // The API's refusal of a field (a name or phone it cannot save yet) shows by that field.
        const fields = fieldErrorsOf(error);
        if (fields) setErrors({ ...found, ...fields });
        else if (errorCode(error) === 'EMAIL_TAKEN')
          setErrors({ ...found, email: TEAM_ERROR_MESSAGES['EMAIL_TAKEN'] });
        setProblem(errorMessage(error, TEAM_ERROR_MESSAGES));
      },
    });
  }

  const scopeLabel = ACCESS_SCOPES.find((scope) => scope.id === values.scope)?.label;
  const invitation =
    values.invite.email && values.invite.sms
      ? 'Email and text message'
      : values.invite.email
        ? 'Email'
        : values.invite.sms
          ? 'Text message'
          : 'No invitation';
  const name = `${values.firstName} ${values.lastName}`.trim();

  const form = (
    <form
      noValidate
      onSubmit={submit}
      aria-label={mode === 'create' ? 'Add Team Member' : 'Edit Team Member'}
      className="flex flex-col gap-5"
    >
      {unavailable ? (
        <p data-testid={unavailable.testId} className="text-sm text-muted">
          {unavailable.message}
        </p>
      ) : null}
      {self ? (
        <Callout icon={LockSimple} surface="info" size="compact">
          This is you. You can update your name, phone and job title; your role, access and status
          can only be changed by someone above you.
        </Callout>
      ) : member && lockRole ? (
        <Callout icon={LockSimple} surface="info" size="compact">
          Changing {member.name}&apos;s department, role or permissions is outside your authority.
        </Callout>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="First Name *"
          placeholder="Enter first name"
          autoComplete="off"
          maxLength={50}
          value={values.firstName}
          disabled={disabled}
          error={errors.firstName}
          onChange={(event) => change({ firstName: event.target.value })}
        />
        <Input
          label="Last Name *"
          placeholder="Enter last name"
          autoComplete="off"
          maxLength={50}
          value={values.lastName}
          disabled={disabled}
          error={errors.lastName}
          onChange={(event) => change({ lastName: event.target.value })}
        />
      </div>
      <Input
        label="Email Address *"
        type="email"
        placeholder="name@company.com"
        autoComplete="off"
        maxLength={254}
        value={values.email}
        disabled={disabled || mode === 'edit'}
        error={errors.email}
        onChange={(event) => change({ email: event.target.value })}
      />
      {mode === 'edit' ? (
        <p className="-mt-3 text-xs text-muted">
          The email is their sign-in, so it can&apos;t be changed here.
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Phone Number"
          type="tel"
          placeholder="(555) 010-0100"
          autoComplete="off"
          maxLength={20}
          value={values.phone}
          disabled={disabled}
          error={errors.phone}
          onChange={(event) => change({ phone: event.target.value })}
        />
        <Input
          label="Job Title"
          placeholder={role ? role.title : 'Shown in the directory'}
          maxLength={80}
          value={values.jobTitle}
          disabled={disabled}
          error={errors.jobTitle}
          onChange={(event) => change({ jobTitle: event.target.value })}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1">
          <Select
            label="Department *"
            value={values.departmentId}
            disabled={lockDepartment}
            error={errors.departmentId}
            onChange={(event) => chooseDepartment(event.target.value)}
            options={[
              { value: '', label: 'Select a department' },
              ...options.departments.map(({ id, name: label }) => ({ value: id, label })),
            ]}
          />
          {mode === 'create' && options.departmentLocked ? (
            <p className="text-xs text-muted">You add people to your own department.</p>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Select
            id="role"
            label="Role *"
            value={values.roleId}
            disabled={lockRole || !values.departmentId}
            error={errors.roleId}
            onChange={(event) => chooseRole(event.target.value)}
            options={[
              {
                value: '',
                label: values.departmentId ? 'Select a role' : 'Select a department first',
              },
              ...roles.map((entry) => ({
                value: entry.id,
                label: entry.needsApproval ? `${entry.title} (needs approval)` : entry.title,
              })),
            ]}
          />
          {role ? (
            <p data-testid="authority-level" className="text-xs text-muted">
              Authority level {role.level}: {AUTHORITY_LEVELS[role.level]}
            </p>
          ) : values.departmentId && roles.length === 0 ? (
            <p className="text-xs text-muted">There are no roles here you can assign.</p>
          ) : null}
        </div>
      </div>
      {role?.needsApproval ? (
        <Callout
          icon={Warning}
          surface="warning"
          tone="amber"
          size="compact"
          title="Department head approval"
        >
          VP / Director roles are assigned by the department&apos;s Chief Officer. This person is
          saved as Pending Approval and invited once the role is approved.
        </Callout>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Reports To"
          value={values.reportsToId}
          disabled={lockRole || !role}
          error={errors.reportsToId}
          onChange={(event) => change({ reportsToId: event.target.value })}
          options={[
            { value: '', label: role ? 'No direct supervisor' : 'Select a role first' },
            ...supervisors.map((person) => ({
              value: person.id,
              label: `${person.name} (${person.roleTitle})`,
            })),
          ]}
        />
        <Select
          label="Location / Office"
          value={values.locationId}
          disabled={disabled}
          error={errors.locationId}
          onChange={(event) => change({ locationId: event.target.value })}
          options={[
            { value: '', label: 'No location' },
            ...options.locations.map(({ id, name: label }) => ({ value: id, label })),
          ]}
        />
        <Select
          label="Team"
          value={values.teamId}
          disabled={disabled || !values.departmentId}
          error={errors.teamId}
          onChange={(event) => change({ teamId: event.target.value })}
          options={[
            { value: '', label: teams.length ? 'No team' : 'No teams in this department' },
            ...teams.map(({ id, name: label }) => ({ value: id, label })),
          ]}
        />
        <Select
          label="Access Scope *"
          value={values.scope}
          disabled={lockRole}
          error={errors.scope}
          onChange={(event) => change({ scope: event.target.value as SaveTeamMember['scope'] })}
          options={[
            { value: '', label: 'Select an access scope' },
            ...ACCESS_SCOPES.filter((scope) => options.scopes.includes(scope.id)).map((scope) => ({
              value: scope.id,
              label: `${scope.label}: ${scope.description}`,
            })),
          ]}
        />
        <Select
          label="Status *"
          value={values.status}
          disabled={lockStatus}
          error={errors.status}
          onChange={(event) => change({ status: event.target.value as SaveTeamMember['status'] })}
          options={[
            { value: '', label: 'Select a status' },
            ...options.statuses.map((status) => ({
              value: status,
              label: MEMBER_STATUSES[status],
            })),
          ]}
        />
      </div>

      <AccessPermissions
        value={values.permissions}
        onChange={(permissions) => change({ permissions })}
        template={template}
        ceiling={ceiling}
        unrestricted={options.unrestricted || disabled}
        readOnly={lockPermissions}
        custom={custom}
        note={
          self || disabled
            ? undefined
            : lockPermissions
              ? "Permissions come from the role's template. Only admins who may customize permissions change them."
              : role
                ? `The ${role.title} template is loaded. Changes beyond it are saved as custom permissions.`
                : 'Choose a role to load its standard permissions.'
        }
      />

      {mode === 'create' ? (
        <section aria-labelledby="send-invitation" className="flex flex-col gap-3">
          <h2 id="send-invitation" className="text-lg font-semibold text-heading">
            Send Invitation
          </h2>
          <CheckLine
            checked={values.invite.email}
            onChange={(on) => change({ invite: { ...values.invite, email: on } })}
            label="Send an invitation email to this team member"
            description="They'll receive an email with setup instructions."
            disabled={disabled}
          />
          <CheckLine
            checked={values.invite.sms}
            onChange={(on) => change({ invite: { ...values.invite, sms: on } })}
            label="Also send a text message invitation"
            description="Sent to the phone number above."
            disabled={disabled}
          />
          {errors.invite ? <p className="text-xs text-danger">{errors.invite}</p> : null}
        </section>
      ) : null}

      {problem ? (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      ) : null}

      <div className="flex flex-wrap justify-end gap-3 border-t border-divider pt-5">
        <ButtonLink href="/team" variant="secondary">
          Cancel
        </ButtonLink>
        <Button type="submit" disabled={disabled || save.isPending}>
          {mode === 'create' ? 'Add Team Member' : 'Save Changes'}
        </Button>
      </div>
    </form>
  );

  const review = (
    <SideCard title="Review">
      <dl data-testid="member-review">
        <ReviewRow label="Name">{name || '—'}</ReviewRow>
        <ReviewRow label="Email">{values.email.trim() || '—'}</ReviewRow>
        <ReviewRow label="Department">
          {options.departments.find((entry) => entry.id === values.departmentId)?.name ?? '—'}
        </ReviewRow>
        <ReviewRow label="Team">
          {options.teams.find((entry) => entry.id === values.teamId)?.name ?? '—'}
        </ReviewRow>
        <ReviewRow label="Role">{role ? `${role.title} (level ${role.level})` : '—'}</ReviewRow>
        <ReviewRow label="Reports To">
          {supervisors.find((person) => person.id === values.reportsToId)?.name ??
            (role ? 'No direct supervisor' : '—')}
        </ReviewRow>
        <ReviewRow label="Permission Level and Scope">
          {role
            ? `${ACCESS_LEVELS[accessLevelOf(role.level)]}, ${scopeLabel ?? 'no scope yet'}`
            : '—'}
        </ReviewRow>
        <ReviewRow label="Access">
          <span className="flex flex-wrap items-center gap-2">
            {moduleCount} of {modules.length} modules
            {custom ? <Badge tone="warning">Custom</Badge> : null}
          </span>
        </ReviewRow>
        {mode === 'create' ? <ReviewRow label="Invitation">{invitation}</ReviewRow> : null}
        <ReviewRow label="Status">
          {role?.needsApproval && mode === 'create'
            ? MEMBER_STATUSES.PENDING_APPROVAL
            : values.status
              ? MEMBER_STATUSES[values.status]
              : '—'}
        </ReviewRow>
      </dl>
      <p className="mt-3 flex gap-2 text-xs text-muted">
        <Info aria-hidden weight="fill" className="size-4 shrink-0 text-action" />
        Every change to a role, permission or status is written to the audit log.
      </p>
    </SideCard>
  );

  return (
    <>
      <FormLayout
        form={form}
        aside={
          <>
            {unavailable ? (
              <SideCard title="Review">
                <p className="text-sm text-muted">{unavailable.message}</p>
              </SideCard>
            ) : (
              review
            )}
            {aside}
          </>
        }
      />
      <Modal
        open={pendingRole !== null}
        title="Replace custom permissions?"
        onClose={() => setPendingRole(null)}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                if (pendingRole) applyRole(pendingRole, false);
                setPendingRole(null);
              }}
            >
              Keep Current Permissions
            </Button>
            <Button
              onClick={() => {
                if (pendingRole) applyRole(pendingRole, true);
                setPendingRole(null);
              }}
            >
              Load Role Defaults
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">
          {name || 'This person'} has custom permissions. Changing the role to{' '}
          <strong>{pendingRole?.title}</strong> loads its standard template and replaces them.
        </p>
      </Modal>
    </>
  );
}
