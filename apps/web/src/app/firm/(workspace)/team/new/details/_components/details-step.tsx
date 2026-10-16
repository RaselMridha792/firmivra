'use client';

import {
  StaffAccountInput,
  StaffCompensationInput,
  type StaffDetailsInput as DetailsInput,
  StaffDetailsInput,
  type StaffDocumentType,
  type StaffDraftData,
  type StaffEmploymentType,
  type StaffPayFrequency,
  type StaffPayType,
} from '@firmivra/types';
import { Button, Callout, Checkbox, FileDropzone, Input, Select } from '@firmivra/ui';
import {
  ArrowLeft,
  Briefcase,
  CurrencyDollar,
  FileText,
  Info,
  LockSimple,
  PaperPlaneTilt,
  UsersThree,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { uploadFile } from '../../../../../../../lib/upload';
import { SectionCard } from '../../_components/section-card';
import { WithDraft, useDraftSaver } from '../../_components/with-draft';
import { WizardHeader } from '../../_components/wizard-header';
import {
  EMPLOYMENT_TYPES,
  STAFF_ERRORS,
  TIME_ZONES,
  stepHref,
} from '../../_components/wizard-parts';
import { AccountPreview, WizardNotes, previewFromDraft } from '../../_components/wizard-side';

const PAY_TYPES: Record<StaffPayType, string> = {
  SALARY: 'Salary',
  HOURLY: 'Hourly',
  COMMISSION: 'Commission',
  PER_PROJECT: 'Per Project',
  OTHER: 'Other',
};

const PAY_FREQUENCIES: Record<StaffPayFrequency, string> = {
  WEEKLY: 'Weekly',
  BIWEEKLY: 'Every two weeks',
  SEMIMONTHLY: 'Twice a month',
  MONTHLY: 'Monthly',
  ANNUALLY: 'Annually',
};

const DOCUMENT_TYPES: Record<StaffDocumentType, string> = {
  EMPLOYMENT_AGREEMENT: 'Employment Agreement',
  CONTRACTOR_AGREEMENT: 'Contractor Agreement',
  W4: 'W-4 Form',
  DIRECT_DEPOSIT: 'Direct Deposit Form',
  NDA: 'NDA',
  CREDENTIAL_LICENSE: 'Credential / License',
  TRAINING_ACKNOWLEDGMENT: 'Training Acknowledgment',
  OTHER: 'Other',
};

/** A file chosen here; it uploads once the account exists (documents belong to a member). */
interface QueuedFile {
  key: string;
  file: File;
  type: StaffDocumentType;
}

interface Form {
  employmentType: StaffEmploymentType | '';
  endDate: string;
  workSchedule: string;
  supervisorId: string;
  office: string;
  timeZone: string;
  hireDate: string;
  employeeId: string;
  primaryTeamId: string;
  primarySpecialty: string;
  backupTeamId: string;
  maxWorkload: string;
  acceptsNewClients: boolean;
  payType: StaffPayType | '';
  commission: string;
  rate: string;
  payFrequency: StaffPayFrequency | '';
  payrollId: string;
}

function fromDraft(d: StaffDraftData): Form {
  const x = d.details ?? {};
  return {
    employmentType: x.employmentType ?? '',
    endDate: x.endDate ?? '',
    workSchedule: x.workSchedule ?? '',
    supervisorId: x.supervisorId ?? '',
    office: x.office ?? '',
    timeZone: x.timeZone ?? 'America/New_York',
    hireDate: x.hireDate ?? '',
    employeeId: x.employeeId ?? '',
    primaryTeamId: x.primaryTeamId ?? '',
    primarySpecialty: x.primarySpecialty ?? '',
    backupTeamId: x.backupTeamId ?? '',
    maxWorkload: x.maxWorkload != null ? String(x.maxWorkload) : '',
    acceptsNewClients: x.acceptsNewClients ?? true,
    // Pay is never in a draft (contract): it starts empty every time.
    payType: '',
    commission: '',
    rate: '',
    payFrequency: '',
    payrollId: '',
  };
}

function toDetails(f: Form): DetailsInput {
  return {
    employmentType: f.employmentType || null,
    workSchedule: f.workSchedule || null,
    office: f.office || null,
    hireDate: f.hireDate || null,
    endDate: f.endDate || null,
    supervisorId: f.supervisorId || null,
    timeZone: f.timeZone || null,
    employeeId: f.employeeId.trim() || null,
    primaryTeamId: f.primaryTeamId || null,
    backupTeamId: f.backupTeamId || null,
    primarySpecialty: f.primarySpecialty || null,
    maxWorkload: f.maxWorkload.trim() ? Number(f.maxWorkload) : null,
    acceptsNewClients: f.acceptsNewClients,
  };
}

/** Pay in cents, or nothing when no pay field was filled. */
function toCompensation(f: Form) {
  const filled = f.payType || f.rate.trim() || f.payFrequency || f.commission || f.payrollId;
  if (!filled) return undefined;
  return {
    payType: f.payType || null,
    rateCents: f.rate.trim() ? Math.round(Number(f.rate) * 100) : null,
    payFrequency: f.payFrequency || null,
    commission: f.commission.trim() || null,
    payrollId: f.payrollId.trim() || null,
  };
}

const MESSAGES: Record<string, string> = {
  maxWorkload: 'Use a whole number from 1 to 10,000.',
  employeeId: 'Use up to 40 characters.',
  rateCents: 'Enter an amount like 55000.00.',
  payrollId: 'Use up to 40 characters.',
  commission: 'Use up to 200 characters.',
};

function check(f: Form): Record<string, string> {
  const errors: Record<string, string> = {};
  const details = StaffDetailsInput.safeParse(toDetails(f));
  if (!details.success) {
    for (const issue of details.error.issues) {
      const field = String(issue.path[0] ?? '');
      if (field && !errors[field]) errors[field] = MESSAGES[field] ?? issue.message;
    }
  }
  if (f.rate.trim() && !Number.isFinite(Number(f.rate)))
    errors.rateCents = MESSAGES.rateCents ?? '';
  const pay = toCompensation(f);
  if (pay) {
    const result = StaffCompensationInput.safeParse(pay);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = String(issue.path[0] ?? '');
        if (field && !errors[field]) errors[field] = MESSAGES[field] ?? issue.message;
      }
    }
  }
  return errors;
}

/**
 * Create Staff, step 4 (additinal-details-tab-4.jpg, guide §8-10): employment, team assignment,
 * compensation (Owner and Admin only, never kept in a draft) and staff documents, then Submit &
 * Send Invitation. Documents belong to a member, so the chosen files upload right after the
 * account is created; the Success page then opens.
 */
export function DetailsStep({ draftId }: { draftId?: string }) {
  return (
    <WithDraft draftId={draftId} step="details">
      {(state) => <DetailsForm {...state} />}
    </WithDraft>
  );
}

function DetailsForm({
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
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [fileNote, setFileNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [stepOne, setStepOne] = useState('');
  const [uploading, setUploading] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const draft = useDraftSaver(startDraft, 4);
  const create = useApiMutation(
    (body: Parameters<typeof api.staff.create>[0]) => api.staff.create(body),
    { invalidate: ['staff'] },
  );
  const set = <K extends keyof Form>(field: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [field]: value }));
    draft.touched();
  };
  const data = (): StaffDraftData => ({ ...base, details: toDetails(form) });
  const pending = draft.pending || create.isPending || uploading;

  const submit = () => {
    const found = check(form);
    setErrors(found);
    if (Object.keys(found).length) return;
    // Step 1 must be complete before anything is created.
    const account = StaffAccountInput.safeParse(base.account ?? {});
    if (!account.success) {
      setStepOne('Account Information is not complete yet. Finish step 1 first.');
      return;
    }
    setStepOne('');
    create.mutate(
      {
        idempotencyKey: key,
        account: base.account as Parameters<typeof api.staff.create>[0]['account'],
        permissions: base.permissions,
        access: base.access,
        details: toDetails(form),
        compensation: toCompensation(form),
        sendWelcomeEmail: base.sendWelcomeEmail ?? true,
        ...(draft.draftId ? { draftId: draft.draftId } : {}),
      },
      {
        onSuccess: async (res) => {
          const id = res.staff.id;
          let failed = 0;
          setUploading(true);
          for (const q of files) {
            try {
              await uploadFile(q.file, {
                start: (facts) =>
                  api.staff.createDocumentUpload(id, {
                    ...facts,
                    contentType: facts.contentType as never,
                    type: q.type,
                  }),
                finish: (uploadToken) => api.staff.confirmDocumentUpload(id, { uploadToken }),
              });
            } catch {
              failed += 1;
            }
          }
          setUploading(false);
          router.push(`/team/${id}/created${failed ? `?documentsFailed=${failed}` : ''}`);
        },
      },
    );
  };

  const teams = (o?.teams ?? []).filter(
    (t) =>
      !base.account?.departmentIds?.length || base.account.departmentIds.includes(t.departmentId),
  );
  const teamOptions = (none: string) => [
    { value: '', label: none },
    ...teams.map((t) => ({ value: t.id, label: t.name })),
  ];
  const preview = previewFromDraft(
    { ...base, details: { ...base.details, employmentType: form.employmentType || null } },
    o,
    base.sendWelcomeEmail === false ? 'Not Invited' : 'Pending Invite',
  );
  const hint = 'text-xs text-muted';
  const grid = 'grid gap-4 md:grid-cols-2';

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <WizardHeader step="details" />
      {notice ? (
        <Callout icon={Info} tone="navy" surface="plain" size="compact">
          {notice}
        </Callout>
      ) : null}
      {/* The design's two-to-one split from 1440 px; narrower, the side cards go under. */}
      <div className="grid grid-cols-1 items-start gap-4 min-[1440px]:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 min-[1440px]:col-span-2">
          <SectionCard
            id="additional-details"
            number={4}
            title="Additional Details"
            subtitle="Add optional information, team assignment, employment details, and supporting documents."
            icon={FileText}
          >
            {options.isError ? (
              <Callout icon={Info} tone="navy" surface="plain" size="compact">
                The choices could not be loaded right now. They fill in once the data is available.
              </Callout>
            ) : null}
          </SectionCard>

          <SubCard
            id="employment-information"
            title="Employment Information"
            subtitle="Set employment type, schedule, and work location."
            icon={Briefcase}
          >
            <div className={grid}>
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
                label="End Date (if applicable)"
                type="date"
                value={form.endDate}
                onChange={(e) => set('endDate', e.target.value)}
              />
              <Select
                label="Work Schedule"
                options={[
                  { value: '', label: 'Select schedule' },
                  ...(o?.workSchedules ?? []).map((x) => ({ value: x, label: x })),
                ]}
                value={form.workSchedule}
                onChange={(e) => set('workSchedule', e.target.value)}
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
                label="Office / Branch"
                options={[
                  { value: '', label: 'Select office' },
                  ...(o?.offices ?? []).map((x) => ({ value: x, label: x })),
                ]}
                value={form.office}
                onChange={(e) => set('office', e.target.value)}
              />
              <Select
                label="Time Zone"
                options={TIME_ZONES.map(([value, label]) => ({ value, label }))}
                value={form.timeZone}
                onChange={(e) => set('timeZone', e.target.value)}
              />
              <Input
                label="Hire Date"
                type="date"
                value={form.hireDate}
                onChange={(e) => set('hireDate', e.target.value)}
              />
              <Input
                label="Employee ID (Optional)"
                placeholder="e.g., EMP001"
                maxLength={40}
                value={form.employeeId}
                error={errors.employeeId}
                onChange={(e) => set('employeeId', e.target.value)}
              />
            </div>
          </SubCard>

          <SubCard
            id="team-assignment"
            title="Team Assignment"
            subtitle="Assign this staff member to a team and identify additional team access."
            icon={UsersThree}
          >
            <div className={grid}>
              <Select
                label="Primary Team"
                options={teamOptions('Select team')}
                value={form.primaryTeamId}
                onChange={(e) => set('primaryTeamId', e.target.value)}
              />
              <Select
                label="Primary Service Specialty"
                options={[
                  { value: '', label: 'Select specialty' },
                  ...(o?.serviceAreas ?? []).map((x) => ({ value: x.code, label: x.label })),
                ]}
                value={form.primarySpecialty}
                onChange={(e) => set('primarySpecialty', e.target.value)}
              />
              <Select
                label="Backup Team (Optional)"
                options={teamOptions('Select team')}
                value={form.backupTeamId}
                onChange={(e) => set('backupTeamId', e.target.value)}
              />
              <div className="flex min-w-0 items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Input
                    label="Maximum Workload (Optional)"
                    inputMode="numeric"
                    placeholder="e.g., 50"
                    value={form.maxWorkload}
                    error={errors.maxWorkload}
                    onChange={(e) => set('maxWorkload', e.target.value)}
                  />
                </div>
                <span className="pb-2.5 text-sm text-muted">clients/tasks</span>
              </div>
            </div>
            <Checkbox
              label="Can receive new client assignments"
              checked={form.acceptsNewClients}
              onChange={(e) => set('acceptsNewClients', e.target.checked)}
              className="text-sm"
            />
            {!teams.length && o ? (
              <p className={hint}>No active teams in these departments yet.</p>
            ) : null}
          </SubCard>

          <SubCard
            id="compensation-information"
            title="Compensation Information"
            subtitle="Add compensation details (visible to authorized administrators only)."
            icon={CurrencyDollar}
          >
            <div className={`${grid} items-start`}>
              <Select
                label="Pay Type"
                options={[
                  { value: '', label: 'Select pay type' },
                  ...Object.entries(PAY_TYPES).map(([value, label]) => ({ value, label })),
                ]}
                value={form.payType}
                onChange={(e) => set('payType', e.target.value as StaffPayType | '')}
              />
              <Input
                label="Commission Arrangement (if applicable)"
                placeholder="e.g., 10% of new client fees"
                maxLength={200}
                value={form.commission}
                error={errors.commission}
                onChange={(e) => set('commission', e.target.value)}
              />
              <div className="grid items-start gap-4 sm:grid-cols-2">
                <div className="flex min-w-0 items-end gap-2">
                  <span aria-hidden className="pb-2.5 text-sm font-semibold text-heading">
                    $
                  </span>
                  <div className="min-w-0 flex-1">
                    <Input
                      label="Pay Rate / Salary"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={form.rate}
                      error={errors.rateCents}
                      onChange={(e) => set('rate', e.target.value)}
                    />
                  </div>
                </div>
                <Select
                  label="Pay Frequency"
                  options={[
                    { value: '', label: 'Select frequency' },
                    ...Object.entries(PAY_FREQUENCIES).map(([value, label]) => ({
                      value,
                      label,
                    })),
                  ]}
                  value={form.payFrequency}
                  onChange={(e) => set('payFrequency', e.target.value as StaffPayFrequency | '')}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-3">
                <Input
                  label="Internal Payroll ID (Optional)"
                  placeholder="e.g., PR001"
                  maxLength={40}
                  value={form.payrollId}
                  error={errors.payrollId}
                  onChange={(e) => set('payrollId', e.target.value)}
                />
                <Callout icon={LockSimple} tone="navy" surface="warning" size="compact">
                  Compensation details are only visible to administrators and authorized HR
                  personnel. They are not kept in a draft.
                </Callout>
              </div>
            </div>
          </SubCard>

          <SubCard
            id="staff-documents"
            title="Staff Documents"
            subtitle="Upload important staff-related documents."
            icon={FileText}
          >
            <div className="grid gap-4 lg:grid-cols-[2fr_3fr]">
              <FileDropzone
                label="Staff documents"
                multiple
                accept={['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx']}
                maxBytes={10 * 1024 * 1024}
                title="Drag & drop files here or click to upload"
                hints={['Accepted formats: PDF, JPG, PNG, DOC, DOCX', 'Max size: 10MB per file']}
                onFiles={(chosen) => {
                  setFileNote('');
                  setFiles((list) => [
                    ...list,
                    ...chosen.map((file) => ({
                      key: crypto.randomUUID(),
                      file,
                      type: 'OTHER' as StaffDocumentType,
                    })),
                  ]);
                }}
                onReject={(rejections) =>
                  setFileNote(
                    `${rejections.length} file${rejections.length === 1 ? ' was' : 's were'} not added: use PDF, JPG, PNG, DOC or DOCX up to 10 MB.`,
                  )
                }
              />
              <div className="min-w-0 overflow-x-auto rounded-lg border border-divider">
                <table className="w-full text-left text-sm" data-testid="staff-documents">
                  <caption className="sr-only">Staff documents to upload</caption>
                  <thead className="bg-table-head text-xs text-text">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-semibold">
                        Document Type
                      </th>
                      <th scope="col" className="px-3 py-2 font-semibold">
                        File Name
                      </th>
                      <th scope="col" className="px-3 py-2 font-semibold">
                        Upload Date
                      </th>
                      <th scope="col" className="px-3 py-2 font-semibold">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.length ? (
                      files.map((q) => (
                        <tr key={q.key} className="border-t border-divider">
                          <td className="px-3 py-1.5">
                            <Select
                              label={`Document type of ${q.file.name}`}
                              hideLabel
                              options={Object.entries(DOCUMENT_TYPES).map(([value, label]) => ({
                                value,
                                label,
                              }))}
                              value={q.type}
                              onChange={(e) =>
                                setFiles((list) =>
                                  list.map((x) =>
                                    x.key === q.key
                                      ? { ...x, type: e.target.value as StaffDocumentType }
                                      : x,
                                  ),
                                )
                              }
                            />
                          </td>
                          <td className="max-w-48 truncate px-3 py-1.5 text-link">{q.file.name}</td>
                          <td className="px-3 py-1.5 text-muted">On submit</td>
                          <td className="px-3 py-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                setFiles((list) => list.filter((x) => x.key !== q.key))
                              }
                              className="min-h-9 rounded-control px-2 text-sm font-semibold text-danger hover:bg-danger-soft"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr className="border-t border-divider">
                        <td colSpan={4} className="px-3 py-4 text-center text-muted">
                          No documents yet. Files upload when you submit.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            {fileNote ? (
              <p role="alert" className="text-sm text-danger">
                {fileNote}
              </p>
            ) : null}
          </SubCard>

          {stepOne ? (
            <p role="alert" className="text-sm text-danger">
              {stepOne}{' '}
              <Link href={stepHref('account', draft.draftId)} className="font-semibold underline">
                Open Account Information
              </Link>
            </p>
          ) : null}
          {create.error || draft.error ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(create.error ?? draft.error, STAFF_ERRORS)}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => draft.save(data(), (id) => router.push(stepHref('security', id)))}
            >
              <ArrowLeft aria-hidden weight="bold" className="size-4" />
              Back
            </Button>
            {draft.saved ? (
              <span role="status" className="text-sm text-success" data-testid="draft-saved">
                Draft saved (pay is not kept)
              </span>
            ) : null}
            {uploading ? (
              <span role="status" className="text-sm text-muted">
                Uploading documents…
              </span>
            ) : null}
            <div className="ml-auto flex flex-wrap gap-3">
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  draft.save(data(), (id) =>
                    router.replace(stepHref('details', id), { scroll: false }),
                  )
                }
              >
                Save as Draft
              </Button>
              <Button disabled={pending} onClick={submit}>
                <PaperPlaneTilt aria-hidden weight="fill" className="size-4" />
                Submit &amp; Send Invitation
              </Button>
            </div>
          </div>
        </div>

        <aside className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2 min-[1440px]:grid-cols-1">
          <AccountPreview values={preview} editHref={stepHref('account', draft.draftId)} />
          <WizardNotes
            created="The account will be created with the information above."
            third="The staff member will be set to the selected role, permissions, and access."
            tips
          />
        </aside>
      </div>
    </div>
  );
}

/** A sub-section of step 4 (Employment, Team, Compensation, Documents): tile, title and line. */
function SubCard({
  id,
  title,
  subtitle,
  icon: Glyph,
  children,
}: {
  id: string;
  title: string;
  subtitle: string;
  icon: typeof FileText;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-4 rounded-xl border border-divider bg-surface p-4 shadow-sm"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-info-soft text-heading"
        >
          <Glyph weight="fill" className="size-6" />
        </span>
        <div className="min-w-0">
          <h3 id={id} className="text-lg font-bold text-heading">
            {title}
          </h3>
          <p className="text-sm text-muted">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
