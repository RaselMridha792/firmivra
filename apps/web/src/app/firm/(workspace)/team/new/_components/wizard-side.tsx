import { Avatar, Callout, ChecklistCard } from '@firmivra/ui';
import {
  ArrowSquareOut,
  PaperPlaneTilt,
  Lightbulb,
  PencilSimple,
  Question,
  ShieldCheck,
} from '@phosphor-icons/react';
import Link from 'next/link';
import type { StaffDraftData, StaffFormOptions } from '@firmivra/types';
import { EMPLOYMENT_TYPES } from './wizard-parts';

export interface PreviewValues {
  name: string;
  email: string;
  jobTitle: string;
  departments: string;
  role: string;
  employmentType: string;
  status: string;
}

const dash = (value: string) => value.trim() || '—';

/** Account Preview's lines from the draft (steps 2 to 4), with names from the form options. */
export function previewFromDraft(
  base: StaffDraftData,
  options: StaffFormOptions | undefined,
  status = 'Not Invited',
): PreviewValues {
  const a = base.account ?? {};
  const type = base.details?.employmentType;
  return {
    name: `${a.firstName ?? ''} ${a.lastName ?? ''}`,
    email: a.email ?? '',
    jobTitle: a.jobTitle ?? '',
    departments: (options?.departments ?? [])
      .filter((d) => (a.departmentIds ?? []).includes(d.id))
      .map((d) => d.name)
      .join(', '),
    role: options?.roles.find((r) => r.role === a.role)?.label ?? '',
    employmentType: type ? EMPLOYMENT_TYPES[type] : '',
    status,
  };
}

/** Account Preview: the live summary of the form (guide §3), with Edit back to step 1's top. */
export function AccountPreview({ values, editHref }: { values: PreviewValues; editHref: string }) {
  const rows: [string, string][] = [
    ['Name', values.name],
    ['Email', values.email],
    ['Job Title', values.jobTitle],
    ['Department(s)', values.departments],
    ['Role', values.role],
    ['Employment Type', values.employmentType],
    ['Status', values.status],
  ];
  return (
    <section
      aria-labelledby="account-preview"
      data-testid="account-preview"
      className="flex gap-4 rounded-xl border border-divider bg-surface p-4 shadow-sm"
    >
      <Avatar name={values.name.trim() || '?'} size="xl" />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h2 id="account-preview" className="text-lg font-bold text-heading">
            Account Preview
          </h2>
          <Link
            href={editHref}
            className="inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-link hover:underline"
          >
            <PencilSimple aria-hidden weight="fill" className="size-4" />
            Edit
          </Link>
        </div>
        <dl className="flex flex-col gap-1 text-sm">
          {rows.map(([term, value]) => (
            <div key={term} className="flex min-w-0 gap-1.5">
              <dt className="shrink-0 font-semibold text-heading">{term}:</dt>
              <dd className="min-w-0 break-words text-text">{dash(value)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/** What Happens Next?, Security Best Practices and Need Help? under the preview. */
export function WizardNotes({
  created = 'The account will be created with the selected role and permissions.',
  third = 'The team member will set their password and complete 2FA (if required).',
  later = 'You can edit their account at any time.',
  tips = false,
}: {
  /** What Happens Next?'s first, third and last lines, which change a little per step. */
  created?: string;
  third?: string;
  later?: string;
  /** Step 4 shows Helpful Tips where the other steps show Security Best Practices. */
  tips?: boolean;
} = {}) {
  return (
    <>
      <ChecklistCard
        title="What Happens Next?"
        icon={PaperPlaneTilt}
        iconTone="blue"
        marker="number"
        items={[
          {
            id: 'create',
            label: created,
            done: false,
          },
          {
            id: 'email',
            label: 'A welcome email (and text, if selected) will be sent with login instructions.',
            done: false,
          },
          {
            id: 'password',
            label: third,
            done: false,
          },
          { id: 'edit', label: later, done: false },
        ]}
      />
      {tips ? (
        <ChecklistCard
          title="Helpful Tips"
          icon={Lightbulb}
          iconTone="blue"
          marker="check"
          items={[
            { id: 'documents', label: 'Upload all required employment documents.', done: true },
            { id: 'team', label: 'Verify the correct team and role are assigned.', done: true },
            { id: 'workload', label: 'Set an appropriate workload limit.', done: true },
            { id: 'pay', label: 'Ensure compensation details are accurate.', done: true },
            { id: 'draft', label: 'You can save as a draft and finish later.', done: true },
          ]}
        />
      ) : (
        <ChecklistCard
          title="Security Best Practices"
          icon={ShieldCheck}
          iconTone="green"
          marker="checkbox"
          surface="success"
          items={[
            { id: 'passwords', label: 'Use strong, unique passwords.', done: true },
            { id: 'mfa', label: 'Require two-factor authentication.', done: true },
            { id: 'least', label: 'Limit access to only what’s needed.', done: true },
            { id: 'review', label: 'Review staff access regularly.', done: true },
            {
              id: 'deactivate',
              label: 'Deactivate accounts immediately when no longer needed.',
              done: true,
            },
          ]}
        />
      )}
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
    </>
  );
}
