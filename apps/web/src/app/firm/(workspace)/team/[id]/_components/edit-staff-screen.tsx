'use client';

import {
  FIRM_ROLE_LABELS,
  type MembershipRole,
  type StaffAccessLevel,
  StaffAccountInput,
  type StaffDetail,
  type StaffEmploymentType,
} from '@firmivra/types';
import { Button, Callout, Checkbox, Input, Select } from '@firmivra/ui';
import {
  ArrowSquareOut,
  FileText,
  Info,
  Key,
  LockSimple,
  ShieldCheck,
  Trash,
  User,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { useFirm } from '../../../../../../components/firm-context';
import { api } from '../../../../../../lib/api';
import { errorCode, errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { NOT_LOADED } from '../../_components/quiet-card';
import { MultiPick } from '../../new/_components/multi-pick';
import { SectionCard } from '../../new/_components/section-card';
import { WizardHeader } from '../../new/_components/wizard-header';
import {
  ACCESS_LEVELS,
  EMPLOYMENT_TYPES,
  TIME_ZONES,
  levelForRole,
} from '../../new/_components/wizard-parts';
import { ActionModal, type StaffAction } from './staff-actions';
import { MEMBER_ERRORS, STATUS_LOOKS, canManage, dateTime } from './staff-parts';
import { AccessSummary, NotesCard, ProfileCard, QuickActions, RecentActivity } from './staff-side';

interface Form {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  departmentIds: string[];
  jobTitle: string;
  role: MembershipRole | '';
  serviceAreas: string[];
  accessLevel: StaffAccessLevel | '';
  employmentType: StaffEmploymentType | '';
  hireDate: string;
  office: string;
  endDate: string;
  supervisorId: string;
  timeZone: string;
}

const EMPTY: Form = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  departmentIds: [],
  jobTitle: '',
  role: '',
  serviceAreas: [],
  accessLevel: '',
  employmentType: '',
  hireDate: '',
  office: '',
  endDate: '',
  supervisorId: '',
  timeZone: '',
};

const FIELD_ERRORS: Record<string, string> = {
  firstName: 'Enter a first name.',
  lastName: 'Enter a last name.',
  email: 'Enter a valid work email.',
  phone: 'Enter a valid phone number, or leave it empty.',
  departmentIds: 'Choose at least one department.',
  jobTitle: 'Enter or choose a job title.',
  role: 'Choose a role.',
};

function fromMember(m: StaffDetail): Form {
  const p = m.profile;
  return {
    firstName: m.firstName,
    lastName: m.lastName,
    email: m.email,
    phone: m.phone ?? '',
    departmentIds: m.departments.map((d) => d.id),
    jobTitle: m.jobTitle ?? '',
    role: m.role,
    serviceAreas: m.serviceAreas,
    accessLevel: m.accessLevel,
    employmentType: p.employmentType ?? '',
    hireDate: p.hireDate ?? '',
    office: p.office ?? '',
    endDate: p.endDate ?? '',
    supervisorId: p.supervisor?.id ?? '',
    timeZone: p.timeZone ?? '',
  };
}

const toAccount = (f: Form) => ({
  firstName: f.firstName.trim(),
  lastName: f.lastName.trim(),
  email: f.email.trim(),
  phone: f.phone.trim() || null,
  departmentIds: f.departmentIds,
  jobTitle: f.jobTitle.trim(),
  role: f.role as MembershipRole,
  serviceAreas: f.serviceAreas,
  accessLevel: f.accessLevel || levelForRole(f.role),
});

const toDetails = (f: Form) => ({
  employmentType: f.employmentType || null,
  hireDate: f.hireDate || null,
  office: f.office || null,
  endDate: f.endDate || null,
  supervisorId: f.supervisorId || null,
  timeZone: f.timeZone || null,
});

/** Only what changed is sent, so Save Changes never overwrites a field nobody touched. */
function changed<T extends object>(next: T, before: T): Partial<T> | undefined {
  const out = Object.fromEntries(
    Object.entries(next).filter(
      ([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k as keyof T]),
    ),
  ) as Partial<T>;
  return Object.keys(out).length ? out : undefined;
}

function check(f: Form): Record<string, string> {
  const result = StaffAccountInput.safeParse(toAccount(f));
  if (result.success) return {};
  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = String(issue.path[0] ?? '');
    if (field && !errors[field]) errors[field] = FIELD_ERRORS[field] ?? issue.message;
  }
  return errors;
}

/**
 * Edit Staff Account (edit-staff-account.jpg, guide §12): the same four sections as Create Staff,
 * filled from the member (`api.staff.get`), saved into the same record with its `version`
 * (409 SAVE_CONFLICT when someone saved first), and the right-hand profile, Quick Actions, Access
 * Summary, Recent Activity and Notes. Every card keeps its frame when the member or a call is
 * missing (docs/design-match.md rule 2).
 */
export function EditStaffScreen({ id }: { id: string }) {
  const { role } = useFirm();
  const member = useApiQuery(['staff', 'detail', id], () => api.staff.get(id));
  const [action, setAction] = useState<StaffAction | null>(null);
  const [result, setResult] = useState<{ text: string; error?: boolean } | null>(null);
  // Kept here: a save refetches the member, and its new version refills the form below.
  const [saved, setSaved] = useState('');
  const m = member.data;
  const failed = member.isError ? errorMessage(member.error, MEMBER_ERRORS) : undefined;
  // Owner and Admin change other members; nobody changes their own access here.
  const manages = canManage(role) && m !== undefined && !m.isYou;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <WizardHeader step="account" mode="edit" />
      {failed ? (
        <Callout icon={Info} tone="navy" surface="plain" size="compact">
          {errorCode(member.error) === 'NOT_FOUND' ? failed : NOT_LOADED}
        </Callout>
      ) : m?.isYou ? (
        <Callout icon={Info} tone="navy" surface="plain" size="compact">
          This is your own account. Another Owner or Admin changes your role and access.
        </Callout>
      ) : m && !canManage(role) ? (
        <Callout icon={Info} tone="navy" surface="plain" size="compact">
          Only an Owner or an Admin can change staff accounts. You can read this one.
        </Callout>
      ) : null}
      <div className="grid grid-cols-1 items-start gap-4 min-[1440px]:grid-cols-3">
        <EditForm
          // A new version (after Save Changes or a reload) refills the form from the server.
          key={m?.version ?? 'none'}
          id={id}
          member={m}
          manages={manages}
          saved={saved}
          onSaved={setSaved}
          onAction={setAction}
          onReload={() => void member.refetch()}
        />
        <aside className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2 min-[1440px]:grid-cols-1">
          <ProfileCard member={m} loading={member.isPending} failed={failed} />
          <QuickActions
            member={m}
            enabled={manages}
            message={result}
            onAction={(a) => {
              setResult(null);
              setAction(a);
            }}
          />
          <AccessSummary id={id} />
          <RecentActivity id={id} />
          {canManage(role) ? <NotesCard id={id} enabled={manages} /> : null}
        </aside>
      </div>
      {action && m ? (
        <ActionModal
          action={action}
          id={m.id}
          name={m.name}
          onClose={() => setAction(null)}
          onDone={(text) => {
            setAction(null);
            setResult({ text });
          }}
        />
      ) : null}
    </div>
  );
}

function EditForm({
  id,
  member: m,
  manages,
  saved,
  onSaved: setSaved,
  onAction,
  onReload,
}: {
  id: string;
  member: StaffDetail | undefined;
  manages: boolean;
  saved: string;
  onSaved: (text: string) => void;
  onAction: (action: StaffAction) => void;
  onReload: () => void;
}) {
  const options = useApiQuery(['staff', 'options'], () => api.staff.options());
  const security = useApiQuery(['staff', 'security', id], () => api.staff.security(id));
  const o = options.data;
  const initial = m ? fromMember(m) : EMPTY;
  const [form, setForm] = useState<Form>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [mustChange, setMustChange] = useState<boolean | null>(null);
  const [notify, setNotify] = useState(true);
  const set = <K extends keyof Form>(field: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [field]: value }));
    setSaved('');
  };
  const requirePasswordChange = mustChange ?? security.data?.requirePasswordChange ?? false;
  const save = useApiMutation(
    async (body: {
      account?: Partial<ReturnType<typeof toAccount>>;
      details?: Partial<ReturnType<typeof toDetails>>;
      access?: { requirePasswordChange: boolean };
    }) => {
      if (!m) throw new Error('No member');
      // Step 3's password box lives with the security settings, not the member.
      if (body.access) await api.staff.updateSecurity(m.id, body.access);
      if (body.account || body.details) {
        await api.staff.update(m.id, {
          version: m.version,
          ...(body.account ? { account: body.account } : {}),
          ...(body.details ? { details: body.details } : {}),
          notifyMember: notify,
        });
      }
      // Said here, not in mutate's onSuccess: the refetched version remounts this form first.
      setSaved(`Changes saved for ${form.firstName.trim()} ${form.lastName.trim()}.`);
    },
    { invalidate: ['staff'] },
  );
  const locked = !manages || save.isPending;

  const onSave = () => {
    if (!m) return;
    const found = check(form);
    setErrors(found);
    if (Object.keys(found).length) return;
    const account = changed(toAccount(form), toAccount(initial));
    const details = changed(toDetails(form), toDetails(initial));
    const access =
      mustChange !== null && mustChange !== security.data?.requirePasswordChange
        ? { requirePasswordChange: mustChange }
        : undefined;
    if (!account && !details && !access) {
      setSaved('Nothing has changed yet.');
      return;
    }
    save.mutate({ account, details, access });
  };

  const departments = (o?.departments ?? []).map((d) => ({ value: d.id, label: d.name }));
  const roles = (o?.roles ?? []).map((r) => ({ value: r.role, label: r.label }));
  // Keep the member's own values choosable while the options load or when they are missing.
  const roleOptions =
    m && !roles.some((r) => r.value === m.role)
      ? [{ value: m.role, label: FIRM_ROLE_LABELS[m.role] }, ...roles]
      : roles;
  const departmentOptions = m
    ? [
        ...departments,
        ...m.departments
          .filter((d) => !departments.some((x) => x.value === d.id))
          .map((d) => ({ value: d.id, label: d.name })),
      ]
    : departments;
  const supervisors = (o?.managers ?? []).filter((x) => x.id !== m?.id);
  const supervisorOptions = [
    { value: '', label: 'Select manager' },
    ...supervisors.map((x) => ({ value: x.id, label: x.name })),
    ...(m?.profile.supervisor && !supervisors.some((x) => x.id === m.profile.supervisor?.id)
      ? [{ value: m.profile.supervisor.id, label: m.profile.supervisor.name }]
      : []),
  ];
  const offices = [...new Set([...(o?.offices ?? []), ...(form.office ? [form.office] : [])])];
  const fieldGrid = 'grid gap-4 md:grid-cols-2';
  const hint = 'text-xs text-muted';
  const status = m ? STATUS_LOOKS[m.status].label : 'Not loaded';

  return (
    <form
      noValidate
      aria-label="Edit staff account"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
      className="flex min-w-0 flex-col gap-4 min-[1440px]:col-span-2"
    >
      {options.isError ? (
        <Callout icon={Info} tone="navy" surface="plain" size="compact">
          The choices could not be loaded right now. They fill in once the data is available.
        </Callout>
      ) : null}
      <SectionCard
        id="account-information"
        number={1}
        title="Account Information"
        subtitle="Update the staff member’s personal and contact information."
        icon={User}
      >
        <div className={fieldGrid}>
          <Input
            label="First Name *"
            autoComplete="off"
            maxLength={60}
            disabled={locked}
            value={form.firstName}
            error={errors.firstName}
            onChange={(e) => set('firstName', e.target.value)}
          />
          <Input
            label="Last Name *"
            autoComplete="off"
            maxLength={60}
            disabled={locked}
            value={form.lastName}
            error={errors.lastName}
            onChange={(e) => set('lastName', e.target.value)}
          />
          <Input
            label="Work Email *"
            type="email"
            autoComplete="off"
            disabled={locked}
            value={form.email}
            error={errors.email}
            onChange={(e) => set('email', e.target.value)}
          />
          <Input
            label="Phone Number"
            type="tel"
            placeholder="(XXX) XXX-XXXX"
            disabled={locked}
            value={form.phone}
            error={errors.phone}
            onChange={(e) => set('phone', e.target.value)}
          />
        </div>
      </SectionCard>

      <SectionCard
        id="role-permissions"
        number={2}
        title="Role & Permissions"
        subtitle="Assign or update their role, department, and service areas."
        icon={ShieldCheck}
      >
        <div className={fieldGrid}>
          {locked ? (
            <Input
              label="Department(s) *"
              disabled
              value={
                m?.departments.map((d) => d.name).join(', ') || (m ? 'No department' : 'Not loaded')
              }
              readOnly
            />
          ) : (
            <MultiPick
              label="Department(s) *"
              placeholder="Select department(s)"
              options={departmentOptions}
              value={form.departmentIds}
              error={errors.departmentIds}
              emptyText="No departments yet. Add one in Teams & Departments."
              onChange={(v) => set('departmentIds', v)}
            />
          )}
          <div className="flex min-w-0 flex-col gap-1">
            <Input
              label="Job Title *"
              list="edit-job-titles"
              maxLength={100}
              disabled={locked}
              value={form.jobTitle}
              error={errors.jobTitle}
              onChange={(e) => set('jobTitle', e.target.value)}
            />
            <datalist id="edit-job-titles">
              {(o?.jobTitles ?? []).map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <Select
              label="Role *"
              disabled={locked}
              options={[{ value: '', label: 'Select a role' }, ...roleOptions]}
              value={form.role}
              error={errors.role}
              onChange={(e) => {
                const next = e.target.value as MembershipRole | '';
                setSaved('');
                setForm((f) => ({
                  ...f,
                  role: next,
                  // The level follows the role unless someone picked another one.
                  accessLevel:
                    f.accessLevel && f.accessLevel !== levelForRole(f.role)
                      ? f.accessLevel
                      : levelForRole(next),
                }));
              }}
            />
            <Link
              href="/team/roles"
              className="inline-flex min-h-8 items-center gap-1.5 self-start text-sm font-semibold text-link hover:underline"
            >
              <ArrowSquareOut aria-hidden weight="bold" className="size-4" />
              Manage Roles &amp; Permissions
            </Link>
          </div>
          {locked ? (
            <Input
              label="Service Area(s)"
              disabled
              readOnly
              value={
                m?.serviceAreas
                  .map((c) => o?.serviceAreas.find((s) => s.code === c)?.label ?? c)
                  .join(', ') || '—'
              }
            />
          ) : (
            <MultiPick
              label="Service Area(s)"
              placeholder="Select service areas"
              options={(o?.serviceAreas ?? []).map((s) => ({ value: s.code, label: s.label }))}
              value={form.serviceAreas}
              onChange={(v) => set('serviceAreas', v)}
            />
          )}
        </div>
      </SectionCard>

      <SectionCard
        id="access-security"
        number={3}
        title="Access & Security"
        subtitle="Manage login access, authentication, and security settings."
        icon={LockSimple}
      >
        <div className={fieldGrid}>
          <div className="flex min-w-0 flex-col gap-1">
            <Select
              label="User Access Level"
              disabled={locked}
              options={Object.entries(ACCESS_LEVELS).map(([value, label]) => ({ value, label }))}
              value={form.accessLevel || levelForRole(form.role)}
              onChange={(e) => set('accessLevel', e.target.value as StaffAccessLevel)}
            />
            <p className={hint}>Access based on assigned role permissions.</p>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            {/* Status changes are actions with their own checks (Deactivate, Lock), not a field. */}
            <Select
              label="Account Status"
              disabled
              options={[{ value: 'status', label: status }]}
              value="status"
              onChange={() => undefined}
            />
            <p className={hint}>Deactivate or reactivate with the account’s actions.</p>
          </div>
          <div className="flex flex-col">
            <Checkbox
              label="Require password change at next login"
              disabled={locked || !security.data}
              checked={requirePasswordChange}
              onChange={(e) => {
                setMustChange(e.target.checked);
                setSaved('');
              }}
              className="text-sm"
            />
            {/* Two-factor sign-in is always on for staff (contract): shown, never turned off. */}
            <Checkbox
              label="Require two-factor authentication (2FA)"
              checked
              disabled
              readOnly
              className="text-sm"
            />
            <Checkbox
              label="Send notification of changes"
              disabled={locked}
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
              className="text-sm"
            />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <Input
              label="Last Login"
              disabled
              readOnly
              value={m?.lastLogin ? dateTime(m.lastLogin.at) : m ? 'Not signed in yet' : '—'}
            />
            <Button
              disabled={locked || !m || (m.status !== 'ACTIVE' && m.status !== 'LOCKED')}
              onClick={() => onAction('resetPassword')}
            >
              <Key aria-hidden weight="fill" className="size-4" />
              Reset Password
            </Button>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        id="additional-details"
        number={4}
        title="Additional Details"
        subtitle="Update employment, team, and internal information."
        icon={FileText}
      >
        <div className={fieldGrid}>
          <Select
            label="Employment Type"
            disabled={locked}
            options={[
              { value: '', label: 'Select employment type' },
              ...Object.entries(EMPLOYMENT_TYPES).map(([value, label]) => ({ value, label })),
            ]}
            value={form.employmentType}
            onChange={(e) => set('employmentType', e.target.value as StaffEmploymentType | '')}
          />
          <Input
            label="Start Date"
            type="date"
            disabled={locked}
            value={form.hireDate}
            onChange={(e) => set('hireDate', e.target.value)}
          />
          <Select
            label="Work Location"
            disabled={locked}
            options={[
              { value: '', label: 'Select location' },
              ...offices.map((x) => ({ value: x, label: x })),
            ]}
            value={form.office}
            onChange={(e) => set('office', e.target.value)}
          />
          <Input
            label="End Date (if applicable)"
            type="date"
            disabled={locked}
            value={form.endDate}
            onChange={(e) => set('endDate', e.target.value)}
          />
          <Select
            label="Supervisor / Manager"
            disabled={locked}
            options={supervisorOptions}
            value={form.supervisorId}
            onChange={(e) => set('supervisorId', e.target.value)}
          />
          <Select
            label="Time Zone"
            disabled={locked}
            options={[
              { value: '', label: 'Select time zone' },
              ...TIME_ZONES.map(([value, label]) => ({ value, label })),
            ]}
            value={form.timeZone}
            onChange={(e) => set('timeZone', e.target.value)}
          />
        </div>
      </SectionCard>

      {save.error ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
          {errorMessage(save.error, MEMBER_ERRORS)}
          {errorCode(save.error) === 'SAVE_CONFLICT' ? (
            <Button variant="secondary" onClick={onReload}>
              Reload
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={locked || m?.status === 'DEACTIVATED'}
          onClick={() => onAction('deactivate')}
          className="inline-flex min-h-11 items-center gap-2 rounded-control border border-danger bg-surface px-6 text-sm font-semibold text-danger hover:bg-danger-soft disabled:cursor-not-allowed disabled:border-border disabled:text-muted disabled:hover:bg-surface"
        >
          <Trash aria-hidden weight="fill" className="size-4" />
          Deactivate Account
        </button>
        {saved ? (
          <span role="status" data-testid="edit-saved" className="text-sm text-success">
            {saved}
          </span>
        ) : null}
        <div className="ml-auto flex flex-wrap gap-3">
          <Link
            href="/team"
            className="inline-flex min-h-11 items-center rounded-control border border-action px-8 text-sm font-semibold text-action hover:bg-folder-surface"
          >
            Cancel
          </Link>
          <Button type="submit" disabled={locked} className="px-8">
            <LockSimple aria-hidden weight="fill" className="size-4" />
            Save Changes
          </Button>
        </div>
      </div>
    </form>
  );
}
