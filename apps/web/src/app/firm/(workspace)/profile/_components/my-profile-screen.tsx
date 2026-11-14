'use client';

import { FIRM_ROLE_LABELS, type UpdateStaffMyProfileRequest } from '@firmivra/types';
import { Avatar, Button, Card, Input, PageHeader, Skeleton } from '@firmivra/ui';
import { UserCircle } from '@phosphor-icons/react';
import Link from 'next/link';
import { type FormEvent, useState } from 'react';
import { MyPhone } from './my-phone';
import { useFirm } from '../../../../../components/firm-context';
import { useMe } from '../../../../../components/signed-in';
import { api } from '../../../../../lib/api';
import { ApiRequestError } from '@firmivra/types';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { useUnsavedChanges } from '../../../../../lib/unsaved';
import { MySecurityCard } from '../../team/_components/my-security-card';

const PROFILE = ['staff-profile'] as const;

/**
 * My Profile (Settings review, Overview items 9 and 20; Dashboard Review 2, R2 NEW2): the
 * signed-in person's own details at this firm. The firm's Owner edits their own name and job title
 * here (Edit Profile, Save or Cancel, audited); every other role reads them, and the Owner changes
 * an employee's details in Staff Management. The work email and the role are never changed here.
 * Never the company profile.
 */
export function MyProfileScreen() {
  const { me } = useMe();
  const { firm, role } = useFirm();
  const profile = useApiQuery(PROFILE, () => api.staffProfile.get());
  const [editing, setEditing] = useState(false);
  const p = profile.data;
  const name = p ? `${p.firstName} ${p.lastName}`.trim() : me.user.name;
  const rows: [string, string][] = [
    ['Name', name],
    ['Work email', p?.email ?? me.user.email],
    ['Job title', p?.jobTitle ?? '—'],
    ['Role', role ? FIRM_ROLE_LABELS[role] : 'Staff'],
    ['Firm', firm.name],
  ];
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader icon={UserCircle} title="My Profile" subtitle="Your own details at this firm." />
      <Card variant="elevated" className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-4">
          <Avatar name={name} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold text-heading">{name}</p>
            <p className="truncate text-sm text-muted">{p?.email ?? me.user.email}</p>
          </div>
          {p?.canEdit && !editing ? (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit Profile
            </Button>
          ) : null}
        </div>
        {profile.isPending ? (
          <Skeleton className="h-32" />
        ) : editing && p ? (
          <EditProfile
            initial={{ firstName: p.firstName, lastName: p.lastName, jobTitle: p.jobTitle ?? '' }}
            onDone={() => setEditing(false)}
          />
        ) : (
          <dl
            data-testid="my-profile"
            className="grid gap-x-6 gap-y-3 border-t border-divider pt-5 sm:grid-cols-[10rem_minmax(0,1fr)]"
          >
            {rows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-sm font-semibold text-heading">{label}</dt>
                <dd className="mb-2 break-words text-sm text-text sm:mb-0">{value}</dd>
              </div>
            ))}
          </dl>
        )}
        <MyPhone />
        <p className="text-sm text-muted">
          {p?.canEdit ? (
            <>
              Your work email and role stay as your sign-in has them. To change an employee&apos;s
              details, open them in{' '}
              <Link href="/team" className="font-medium text-link hover:underline">
                Staff Management
              </Link>
              .
            </>
          ) : (
            <>Your details are managed by your firm&apos;s Owner.</>
          )}{' '}
          Choose which notices reach you in{' '}
          <Link href="/settings/notifications" className="font-medium text-link hover:underline">
            My Settings
          </Link>
          .
        </p>
      </Card>
      <MySecurityCard />
    </div>
  );
}

type Form = { firstName: string; lastName: string; jobTitle: string };

/** The fields the API refused (400 VALIDATION_FAILED), each with its message. */
const fieldErrors = (e: unknown): Record<string, string> =>
  e instanceof ApiRequestError && e.code === 'VALIDATION_FAILED'
    ? Object.fromEntries(
        (e.details ?? []).map((x) => [String(x.path).split('.')[0] ?? '', x.message]),
      )
    : {};

/** Edit Profile (R2 NEW2, the Owner only): Save keeps the changes; Cancel changes nothing. */
function EditProfile({ initial, onDone }: { initial: Form; onDone: () => void }) {
  const [form, setForm] = useState<Form>(initial);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  useUnsavedChanges(dirty);
  const save = useApiMutation(
    (body: UpdateStaffMyProfileRequest) => api.staffProfile.update(body),
    { invalidate: PROFILE },
  );
  const errors = save.error ? fieldErrors(save.error) : {};
  const missing = (v: string) => (v.trim() ? undefined : 'Enter this');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (missing(form.firstName) || missing(form.lastName)) return;
    save.mutate(
      { firstName: form.firstName.trim(), lastName: form.lastName.trim(), jobTitle: form.jobTitle },
      { onSuccess: onDone },
    );
  };
  const set = (key: keyof Form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  return (
    <form
      onSubmit={submit}
      noValidate
      data-testid="edit-profile"
      aria-label="Edit Profile"
      className="flex flex-col gap-4 border-t border-divider pt-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="First name *"
          value={form.firstName}
          maxLength={60}
          autoComplete="given-name"
          error={errors['firstName'] ?? (save.isIdle ? undefined : missing(form.firstName))}
          onChange={set('firstName')}
        />
        <Input
          label="Last name *"
          value={form.lastName}
          maxLength={60}
          autoComplete="family-name"
          error={errors['lastName'] ?? (save.isIdle ? undefined : missing(form.lastName))}
          onChange={set('lastName')}
        />
        <Input
          label="Job title"
          value={form.jobTitle}
          maxLength={100}
          error={errors['jobTitle']}
          onChange={set('jobTitle')}
        />
      </div>
      {save.error && Object.keys(errors).length === 0 ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(save.error)}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          disabled={save.isPending || !dirty || !form.firstName.trim() || !form.lastName.trim()}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="secondary" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
