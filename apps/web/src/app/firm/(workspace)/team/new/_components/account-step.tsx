'use client';

import {
  type MembershipRole,
  type StaffAccessLevel,
  StaffAccountInput,
  type StaffDraftData,
  type StaffEmploymentType,
} from '@firmivra/types';
import { Button, Callout, Checkbox, Input, Select, Skeleton } from '@firmivra/ui';
import {
  ArrowRight,
  ArrowSquareOut,
  FileText,
  Info,
  LockSimple,
  ShieldCheck,
  User,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { MultiPick } from './multi-pick';
import { SectionCard } from './section-card';
import { WizardHeader } from './wizard-header';
import {
  ACCESS_LEVELS,
  EMPLOYMENT_TYPES,
  STAFF_ERRORS,
  TIME_ZONES,
  draftData,
  levelForRole,
  stepHref,
} from './wizard-parts';
import { AccountPreview, WizardNotes } from './wizard-side';

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
  accessStartsOn: string;
  requirePasswordChange: boolean;
  sendWelcomeEmail: boolean;
  employmentType: StaffEmploymentType | '';
  hireDate: string;
  office: string;
  endDate: string;
  supervisorId: string;
  timeZone: string;
}

const FIELD_ERRORS: Record<string, string> = {
  firstName: 'Enter a first name.',
  lastName: 'Enter a last name.',
  email: 'Enter a valid work email.',
  phone: 'Enter a valid phone number, or leave it empty.',
  departmentIds: 'Choose at least one department.',
  jobTitle: 'Enter or choose a job title.',
  role: 'Choose a role.',
};

function fromDraft(d: StaffDraftData): Form {
  const a = d.account ?? {};
  const x = d.details ?? {};
  return {
    firstName: a.firstName ?? '',
    lastName: a.lastName ?? '',
    email: a.email ?? '',
    phone: a.phone ?? '',
    departmentIds: a.departmentIds ?? [],
    jobTitle: a.jobTitle ?? '',
    role: a.role ?? '',
    serviceAreas: a.serviceAreas ?? [],
    accessLevel: a.accessLevel ?? '',
    accessStartsOn: a.accessStartsOn ?? '',
    requirePasswordChange: d.access?.requirePasswordChange ?? true,
    sendWelcomeEmail: d.sendWelcomeEmail ?? true,
    employmentType: x.employmentType ?? '',
    hireDate: x.hireDate ?? '',
    office: x.office ?? '',
    endDate: x.endDate ?? '',
    supervisorId: x.supervisorId ?? '',
    timeZone: x.timeZone ?? 'America/New_York',
  };
}

/** The account as the contract wants it; empty optional fields are left out. */
function toAccount(f: Form) {
  return {
    firstName: f.firstName.trim(),
    lastName: f.lastName.trim(),
    email: f.email.trim(),
    phone: f.phone.trim() || null,
    departmentIds: f.departmentIds,
    jobTitle: f.jobTitle.trim(),
    role: f.role as MembershipRole,
    serviceAreas: f.serviceAreas,
    accessLevel: f.accessLevel || levelForRole(f.role),
    accessStartsOn: f.accessStartsOn || null,
  };
}

function toDetails(f: Form) {
  return {
    employmentType: f.employmentType || null,
    hireDate: f.hireDate || null,
    office: f.office || null,
    endDate: f.endDate || null,
    supervisorId: f.supervisorId || null,
    timeZone: f.timeZone || null,
  };
}

/** What a draft keeps from step 1, merged into the rest of the draft. */
function toDraft(f: Form, base: StaffDraftData): StaffDraftData {
  const a = toAccount(f);
  const account = Object.fromEntries(
    Object.entries({ ...a, role: f.role || undefined }).filter(
      ([, v]) => v !== '' && v !== null && v !== undefined && !(Array.isArray(v) && !v.length),
    ),
  );
  return {
    ...base,
    account,
    access: { ...base.access, requirePasswordChange: f.requirePasswordChange },
    details: { ...base.details, ...toDetails(f) },
    sendWelcomeEmail: f.sendWelcomeEmail,
  };
}

/** Field errors from the contract's own checks (StaffAccountInput), in the screen's words. */
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
 * Create Staff, step 1 (create-staff-account-info.jpg, guide §2-3): the person, their role and
 * department, access basics and assignment in four sections, a live Account Preview, Save as
 * Draft, Next (step 2 with the draft) and Create Account (the contract's step 1 variant).
 */
export function AccountStep({ draftId }: { draftId?: string }) {
  return draftId ? <DraftLoader draftId={draftId} /> : <AccountForm draftId={null} base={{}} />;
}

function DraftLoader({ draftId }: { draftId: string }) {
  const draft = useApiQuery(['staff', 'drafts', draftId], () => api.staff.draft(draftId));
  if (draft.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <WizardHeader step="account" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  // A draft that cannot be read starts an empty form with a quiet note (design-match rule 2).
  return (
    <AccountForm
      draftId={draft.data ? draftId : null}
      base={draft.data ? draftData(draft.data.data) : {}}
      notice={draft.isError ? errorMessage(draft.error, STAFF_ERRORS) : undefined}
    />
  );
}

function AccountForm({
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
  const o = options.data;
  const [form, setForm] = useState<Form>(() => fromDraft(base));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [draftId, setDraftId] = useState(startDraft);
  const [saved, setSaved] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const set = <K extends keyof Form>(field: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [field]: value }));
    setSaved(false);
  };
  const saveDraft = useApiMutation(
    (data: StaffDraftData) =>
      draftId
        ? api.staff.saveDraft(draftId, { step: 1, data })
        : api.staff.createDraft({ step: 1, data }),
    { invalidate: ['staff', 'drafts'] },
  );
  const create = useApiMutation(
    (body: Parameters<typeof api.staff.create>[0]) => api.staff.create(body),
    { invalidate: ['staff'] },
  );
  const pending = saveDraft.isPending || create.isPending;

  const draft = (then: (id: string) => void) =>
    saveDraft.mutate(toDraft(form, base), {
      onSuccess: (d) => {
        setDraftId(d.id);
        setSaved(true);
        then(d.id);
      },
    });
  const onSaveDraft = () =>
    draft((id) => router.replace(stepHref('account', id), { scroll: false }));
  const onNext = () => {
    const found = check(form);
    setErrors(found);
    if (Object.keys(found).length) return;
    draft((id) => router.push(stepHref('permissions', id)));
  };
  const onCreate = () => {
    const found = check(form);
    setErrors(found);
    if (Object.keys(found).length) return;
    create.mutate(
      {
        idempotencyKey: key,
        account: toAccount(form),
        permissions: base.permissions,
        access: { ...base.access, requirePasswordChange: form.requirePasswordChange },
        details: { ...base.details, ...toDetails(form) },
        sendWelcomeEmail: form.sendWelcomeEmail,
        ...(draftId ? { draftId } : {}),
      },
      { onSuccess: (res) => router.push(`/team/${res.staff.id}/created`) },
    );
  };

  const nameOf = (list: { value: string; label: string }[], value: string) =>
    list.find((x) => x.value === value)?.label ?? '';
  const departments = (o?.departments ?? []).map((d) => ({ value: d.id, label: d.name }));
  const roles = (o?.roles ?? []).map((r) => ({ value: r.role, label: r.label }));
  const role = o?.roles.find((r) => r.role === form.role);
  const loadNote = options.isError
    ? 'The choices could not be loaded right now. They fill in once the data is available.'
    : undefined;
  const fieldGrid = 'grid gap-4 md:grid-cols-2';
  const hint = 'text-xs text-muted';

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <WizardHeader step="account" />
      {notice ? (
        <Callout icon={Info} tone="navy" surface="plain" size="compact">
          {notice}
        </Callout>
      ) : null}
      {/* The design's two-to-one split from 1440 px; narrower, the side cards go under. */}
      <div className="grid grid-cols-1 items-start gap-4 min-[1440px]:grid-cols-3">
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            onCreate();
          }}
          className="flex min-w-0 flex-col gap-4 min-[1440px]:col-span-2"
        >
          <SectionCard
            id="account-information"
            number={1}
            title="Account Information"
            subtitle="Enter the team member’s personal and contact information."
            icon={User}
          >
            <div className={fieldGrid}>
              <Input
                label="First Name *"
                placeholder="Enter first name"
                autoComplete="off"
                maxLength={60}
                value={form.firstName}
                error={errors.firstName}
                onChange={(e) => set('firstName', e.target.value)}
              />
              <Input
                label="Last Name *"
                placeholder="Enter last name"
                autoComplete="off"
                maxLength={60}
                value={form.lastName}
                error={errors.lastName}
                onChange={(e) => set('lastName', e.target.value)}
              />
              <Input
                label="Work Email *"
                type="email"
                placeholder="name@yourfirm.com"
                autoComplete="off"
                value={form.email}
                error={errors.email}
                onChange={(e) => set('email', e.target.value)}
              />
              <Input
                label="Phone Number (Optional)"
                type="tel"
                placeholder="(XXX) XXX-XXXX"
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
            subtitle="Assign a role, department, and additional permissions."
            icon={ShieldCheck}
          >
            {loadNote ? (
              <Callout icon={Info} tone="navy" surface="plain" size="compact">
                {loadNote}
              </Callout>
            ) : null}
            <div className={fieldGrid}>
              <MultiPick
                label="Department(s) *"
                placeholder="Select department(s)"
                options={departments}
                value={form.departmentIds}
                error={errors.departmentIds}
                emptyText="No departments yet. Add one in Teams & Departments."
                onChange={(v) => set('departmentIds', v)}
              />
              <div className="flex min-w-0 flex-col gap-1">
                <Input
                  label="Job Title *"
                  placeholder="Select or enter job title"
                  list="job-titles"
                  maxLength={100}
                  value={form.jobTitle}
                  error={errors.jobTitle}
                  onChange={(e) => set('jobTitle', e.target.value)}
                />
                <datalist id="job-titles">
                  {(o?.jobTitles ?? []).map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <Select
                  label="Role *"
                  options={[{ value: '', label: 'Select a role' }, ...roles]}
                  value={form.role}
                  error={errors.role}
                  onChange={(e) => {
                    const next = e.target.value as MembershipRole | '';
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
                {role ? <p className={hint}>{role.description}</p> : null}
                <Link
                  href="/team/roles"
                  className="inline-flex min-h-8 items-center gap-1.5 self-end text-sm font-semibold text-link hover:underline"
                >
                  <ArrowSquareOut aria-hidden weight="bold" className="size-4" />
                  View Role Permissions
                </Link>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <MultiPick
                  label="Service Area(s) (Optional)"
                  placeholder="Select service areas"
                  options={(o?.serviceAreas ?? []).map((s) => ({ value: s.code, label: s.label }))}
                  value={form.serviceAreas}
                  onChange={(v) => set('serviceAreas', v)}
                />
                <p className={hint}>Limits access to specific modules (optional)</p>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            id="access-security"
            number={3}
            title="Access & Security"
            subtitle="Set login access, authentication, and security options."
            icon={LockSimple}
          >
            <div className={fieldGrid}>
              <div className="flex min-w-0 flex-col gap-1">
                <Select
                  label="User Access Level"
                  options={Object.entries(ACCESS_LEVELS).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                  value={form.accessLevel || levelForRole(form.role)}
                  onChange={(e) => set('accessLevel', e.target.value as StaffAccessLevel)}
                />
                <p className={hint}>Access based on assigned role permissions.</p>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <Select
                  label="Account Status"
                  disabled
                  options={[
                    {
                      value: 'status',
                      label: form.sendWelcomeEmail ? 'Pending Invite' : 'Not Invited',
                    },
                  ]}
                  value="status"
                  onChange={() => undefined}
                />
                <p className={hint}>Active once they accept the invitation and sign in.</p>
              </div>
              <div className="flex flex-col">
                <Checkbox
                  label="Require password change at first login"
                  checked={form.requirePasswordChange}
                  onChange={(e) => set('requirePasswordChange', e.target.checked)}
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
                  label="Send welcome email with login instructions"
                  checked={form.sendWelcomeEmail}
                  onChange={(e) => set('sendWelcomeEmail', e.target.checked)}
                  className="text-sm"
                />
              </div>
              <div className="flex min-w-0 flex-col gap-4">
                <Input
                  label="Access Start Date"
                  type="date"
                  value={form.accessStartsOn}
                  onChange={(e) => set('accessStartsOn', e.target.value)}
                />
                <div className="flex min-w-0 flex-col gap-1">
                  <Input
                    label="Temporary Password (Optional)"
                    disabled
                    value="Not used: a secure setup link is sent"
                    readOnly
                  />
                  <p className={hint}>
                    No password is ever set or sent; they choose their own from the link.
                  </p>
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            id="additional-details"
            number={4}
            title="Additional Details"
            subtitle="Add optional employment, team, and internal information."
            icon={FileText}
          >
            <div className={fieldGrid}>
              <Select
                label="Employment Type"
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
                value={form.hireDate}
                onChange={(e) => set('hireDate', e.target.value)}
              />
              <Select
                label="Work Location"
                options={[
                  { value: '', label: 'Select location' },
                  ...(o?.offices ?? []).map((x) => ({ value: x, label: x })),
                ]}
                value={form.office}
                onChange={(e) => set('office', e.target.value)}
              />
              <Input
                label="End Date (if applicable)"
                type="date"
                value={form.endDate}
                onChange={(e) => set('endDate', e.target.value)}
              />
              <Select
                label="Supervisor / Manager"
                options={[
                  { value: '', label: 'Select manager' },
                  ...(o?.managers ?? []).map((m) => ({ value: m.id, label: m.name })),
                ]}
                value={form.supervisorId}
                onChange={(e) => set('supervisorId', e.target.value)}
              />
              <Select
                label="Time Zone"
                options={TIME_ZONES.map(([value, label]) => ({ value, label }))}
                value={form.timeZone}
                onChange={(e) => set('timeZone', e.target.value)}
              />
            </div>
          </SectionCard>

          {saveDraft.error || create.error ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(create.error ?? saveDraft.error, STAFF_ERRORS)}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/team"
              className="inline-flex min-h-11 items-center rounded-control border border-action px-6 text-sm font-semibold text-action hover:bg-folder-surface"
            >
              Cancel
            </Link>
            {saved ? (
              <span role="status" className="text-sm text-success" data-testid="draft-saved">
                Draft saved
              </span>
            ) : null}
            <div className="ml-auto flex flex-wrap gap-3">
              <Button variant="secondary" disabled={pending} onClick={onSaveDraft}>
                Save as Draft
              </Button>
              <Button variant="secondary" disabled={pending} onClick={onNext}>
                Next: Role &amp; Permissions
              </Button>
              <Button type="submit" disabled={pending}>
                Create Account
                <ArrowRight aria-hidden weight="bold" className="size-4" />
              </Button>
            </div>
          </div>
        </form>

        <aside className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2 min-[1440px]:grid-cols-1">
          <AccountPreview
            editHref="#account-information"
            values={{
              name: `${form.firstName} ${form.lastName}`,
              email: form.email,
              jobTitle: form.jobTitle,
              departments: departments
                .filter((d) => form.departmentIds.includes(d.value))
                .map((d) => d.label)
                .join(', '),
              role: nameOf(roles, form.role),
              employmentType: form.employmentType ? EMPLOYMENT_TYPES[form.employmentType] : '',
              status: 'Not Invited',
            }}
          />
          <WizardNotes />
        </aside>
      </div>
    </div>
  );
}
