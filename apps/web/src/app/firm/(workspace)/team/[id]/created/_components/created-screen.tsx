'use client';

import { FIRM_ROLE_LABELS, type TeamMemberStatus } from '@firmivra/types';
import { Avatar, Badge, Button, Callout, ChecklistCard, Skeleton } from '@firmivra/ui';
import {
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  BookOpen,
  Check,
  CheckCircle,
  EnvelopeSimple,
  Info,
  Plus,
  ShieldCheck,
  UserPlus,
  Warning,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useFirm } from '../../../../../../../components/firm-context';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { NOT_LOADED } from '../../../_components/quiet-card';
import {
  ACCESS_LEVELS,
  EMPLOYMENT_TYPES,
  STAFF_ERRORS,
} from '../../../new/_components/wizard-parts';

const STATUS: Record<
  TeamMemberStatus,
  { label: string; tone: 'success' | 'info' | 'warning' | 'neutral' }
> = {
  ACTIVE: { label: 'Active', tone: 'success' },
  INVITED: { label: 'Invited', tone: 'info' },
  LOCKED: { label: 'Locked', tone: 'warning' },
  DEACTIVATED: { label: 'Deactivated', tone: 'neutral' },
};

const date = (iso: string | null | undefined) =>
  iso
    ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
      })
    : '—';

/** The small coloured marks around the success check, as the design scatters them. */
const CONFETTI = [
  'top-2 left-10 bg-gold',
  'top-10 left-2 bg-action',
  'top-20 left-8 bg-success',
  'bottom-2 left-14 bg-action',
  'top-0 right-12 bg-danger',
  'top-12 right-2 bg-action',
  'top-24 right-10 bg-success',
  'bottom-4 right-16 bg-gold',
];

/**
 * Staff Account Created Successfully (succesfully-created-staff.jpg, guide §11): the new member's
 * summary (`api.staff.get`), Resend Invitation (a fresh link, never a second account), View Staff
 * Profile and Add Another Staff Member, What Happens Next?, Security Reminders and Helpful
 * Resources. Documents that failed to upload in step 4 are named.
 */
export function CreatedScreen({ id, documentsFailed }: { id: string; documentsFailed: number }) {
  const { firm } = useFirm();
  const member = useApiQuery(['staff', 'detail', id], () => api.staff.get(id));
  const resend = useApiMutation(() => api.staff.resendInvite(id), { invalidate: ['staff'] });
  const m = member.data;
  const invited = m?.status === 'INVITED';
  const subtitle = m
    ? m.invite
      ? `${m.name} has been added to your team and will receive a welcome email with login instructions shortly.`
      : `${m.name} has been added to your team. No welcome email was sent yet; use Resend Invitation when you are ready.`
    : member.isError
      ? 'The account was created. Its details could not be loaded right now.'
      : 'Loading the new account…';
  const facts: [string, string][] = m
    ? [
        ['Role', FIRM_ROLE_LABELS[m.role]],
        [
          'Employment Type',
          m.profile.employmentType ? EMPLOYMENT_TYPES[m.profile.employmentType] : '—',
        ],
        ['Start Date', date(m.profile.hireDate ?? m.accessStartsOn)],
        ['Primary Team', m.profile.primaryTeam?.name ?? '—'],
        ['Access Level', ACCESS_LEVELS[m.accessLevel]],
      ]
    : [];
  const card = 'rounded-xl border border-divider bg-surface p-5 shadow-sm';

  return (
    <div className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-6">
      <Link
        href="/team"
        className="inline-flex min-h-9 w-fit items-center gap-2 text-sm font-semibold text-link hover:underline"
      >
        <ArrowLeft aria-hidden weight="bold" className="size-4" />
        Back to Staff Management
      </Link>

      <div className="flex flex-col items-center gap-3 text-center">
        <div className="relative flex size-40 items-center justify-center">
          {CONFETTI.map((c) => (
            <span aria-hidden key={c} className={`absolute size-2.5 rotate-45 rounded-sm ${c}`} />
          ))}
          <span
            aria-hidden
            className="flex size-24 items-center justify-center rounded-full bg-success text-on-action"
          >
            <Check weight="bold" className="size-14" />
          </span>
        </div>
        <h1 data-testid="page-title" className="text-3xl font-bold text-heading">
          Staff Account Created Successfully!
        </h1>
        <p className="max-w-2xl text-lg text-link" data-testid="created-summary-line">
          {subtitle}
        </p>
      </div>

      {documentsFailed > 0 ? (
        <Callout icon={Warning} tone="amber" surface="warning" size="compact">
          {documentsFailed} document{documentsFailed === 1 ? '' : 's'} did not upload. Add{' '}
          {documentsFailed === 1 ? 'it' : 'them'} from the staff profile.
        </Callout>
      ) : null}

      <section
        aria-label="Staff summary"
        data-testid="staff-summary"
        className="mx-auto w-full max-w-4xl rounded-xl border border-divider bg-folder-surface p-5"
      >
        {member.isPending ? (
          <Skeleton className="h-28" />
        ) : !m ? (
          <p className="rounded-lg bg-subtle p-4 text-sm text-muted">{NOT_LOADED}</p>
        ) : (
          <div className="grid gap-5 md:grid-cols-[auto_1fr_auto]">
            <Avatar name={m.name} src={m.avatarUrl ?? undefined} size="xl" />
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-3">
                <span className="text-2xl font-bold text-heading">{m.name}</span>
                <Badge tone={STATUS[m.status].tone} icon={CheckCircle}>
                  {STATUS[m.status].label}
                </Badge>
              </p>
              <p className="mt-1 text-link">
                {[m.jobTitle, m.departments.map((d) => `${d.name} Department`).join(', ')]
                  .filter(Boolean)
                  .join('  |  ')}
              </p>
              <p className="mt-1 break-all text-link">{m.email}</p>
              {m.phone ? <p className="text-link">{m.phone}</p> : null}
            </div>
            <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 border-divider text-sm md:border-l md:pl-6">
              {facts.map(([term, value]) => (
                <div key={term} className="contents">
                  <dt className="font-semibold text-heading">{term}:</dt>
                  <dd className="text-text">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </section>

      <div className="mx-auto grid w-full max-w-4xl gap-4 md:grid-cols-3">
        <Button
          disabled={!invited || resend.isPending}
          onClick={() => resend.mutate(undefined)}
          className="min-h-12"
        >
          <EnvelopeSimple aria-hidden weight="fill" className="size-5" />
          Resend Invitation
        </Button>
        <Link
          href={`/team/${id}`}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-control border border-action bg-surface font-semibold text-action hover:bg-folder-surface"
        >
          <UserPlus aria-hidden weight="fill" className="size-5" />
          View Staff Profile
        </Link>
        <Link
          href="/team/new"
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-control border border-action bg-surface font-semibold text-action hover:bg-folder-surface"
        >
          <Plus aria-hidden weight="bold" className="size-5" />
          Add Another Staff Member
        </Link>
      </div>
      {resend.isSuccess ? (
        <p role="status" className="text-center text-sm text-success" data-testid="resent">
          A fresh invitation was sent; the earlier link no longer works.
        </p>
      ) : null}
      {resend.error ? (
        <p role="alert" className="text-center text-sm text-danger">
          {errorMessage(resend.error, STAFF_ERRORS)}
        </p>
      ) : null}
      {m && !invited ? (
        <p className="text-center text-xs text-muted">
          Resend Invitation is for accounts that have not been activated yet.
        </p>
      ) : null}

      <section aria-labelledby="what-next" className={`${card} bg-folder-surface`}>
        <h2 id="what-next" className="mb-4 flex items-center gap-3 text-xl font-bold text-heading">
          <span
            aria-hidden
            className="flex size-11 items-center justify-center rounded-lg bg-info-soft text-action"
          >
            <Info weight="fill" className="size-7" />
          </span>
          What Happens Next?
        </h2>
        <ol className="grid gap-4 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-start">
          {[
            [
              'Welcome Email Sent',
              'A welcome email (and text, if selected) has been sent with login instructions.',
            ],
            [
              'Account Activation',
              'The staff member will set their password and complete 2FA (if required).',
            ],
            [
              `Start Accessing ${firm.name}`,
              'Once activated, they’ll have access based on their role and permissions.',
            ],
          ].flatMap(([title, text], i) => [
            ...(i > 0
              ? [
                  <li key={`arrow-${title}`} aria-hidden className="hidden pt-2 md:block">
                    <ArrowRight weight="bold" className="size-6 text-action" />
                  </li>,
                ]
              : []),
            <li key={title} className="flex gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-action font-bold text-on-action">
                {i + 1}
              </span>
              <span>
                <span className="block font-bold text-heading">{title}</span>
                <span className="text-sm text-muted">{text}</span>
              </span>
            </li>,
          ])}
        </ol>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <ChecklistCard
          title="Security Reminders"
          icon={ShieldCheck}
          iconTone="green"
          marker="check"
          surface="success"
          items={[
            { id: 'password', label: 'Password must be changed at first login', done: true },
            { id: 'mfa', label: 'Two-factor authentication is required', done: true },
            { id: 'limited', label: 'Access is limited to assigned permissions', done: true },
            { id: 'update', label: 'You can update their access at any time', done: true },
          ]}
        />
        <section aria-labelledby="helpful-resources" className={`${card} bg-folder-surface`}>
          <h2
            id="helpful-resources"
            className="mb-4 flex items-center gap-3 text-xl font-bold text-heading"
          >
            <span
              aria-hidden
              className="flex size-11 items-center justify-center rounded-lg bg-info-soft text-heading"
            >
              <BookOpen weight="fill" className="size-7" />
            </span>
            Helpful Resources
          </h2>
          <ul className="flex flex-col gap-3">
            {[
              ['Staff Management Guide', '/team'],
              ['Roles & Permissions Reference', '/team/roles'],
              ['Security Best Practices', `/team/${id}/security`],
            ].map(([label, href]) => (
              <li key={label}>
                <Link
                  href={href ?? '/team'}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-divider bg-surface px-4 font-semibold text-link hover:bg-folder-surface"
                >
                  {label}
                  <ArrowSquareOut aria-hidden weight="bold" className="size-5" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="flex flex-col items-center gap-3 pb-4">
        <Link
          href="/team"
          className="inline-flex min-h-12 items-center gap-2 rounded-control bg-action px-10 font-semibold text-on-action hover:brightness-110"
        >
          Back to Staff Management
          <ArrowRight aria-hidden weight="bold" className="size-5" />
        </Link>
        <Link href="/team" className="min-h-9 font-semibold text-link hover:underline">
          View All Staff Members
        </Link>
      </div>
    </div>
  );
}
