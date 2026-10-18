'use client';

import { type MyProfile, UpdateMyProfileRequest } from '@firmivra/types';
import { Button, Card, Input, Select } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertCircle,
  EyeOff,
  FileText,
  Lock,
  LockKeyhole,
  Pencil,
  Save,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { NameChangeDialog, PROFILE_ERRORS } from './name-change-dialog';
import { NotificationPreferencesCard } from './notification-preferences';
import { PortalPageHeader } from '../../_components/portal-page-header';

type Values = UpdateMyProfileRequest;
const valuesOf = (p: MyProfile): Values => ({
  phone: p.phone ?? '',
  address: {
    line1: p.address.line1 ?? '',
    line2: p.address.line2 ?? '',
    city: p.address.city ?? '',
    state: p.address.state ?? '',
    postalCode: p.address.postalCode ?? '',
  },
  preferredContactMethod: p.preferredContactMethod ?? '',
  referralSource: p.referralSource ?? '',
  additionalInfo: p.additionalInfo ?? '',
});

/**
 * "My Profile" (docs/mockups/client-portal/My profile.png, N05). Name and date of birth are
 * locked (a name change is a request to the firm). Only the primary login edits; a spouse sees
 * the record, an authorized login sees the name only.
 */
const textareaClass =
  'w-full rounded-control border border-border bg-surface px-3 py-2 text-base text-text focus-visible:outline-2 focus-visible:outline-focus disabled:bg-folder-surface';

export function ProfileScreen() {
  const { firmSlug: slug } = useParams<{ firmSlug: string }>();
  const profile = useApiQuery(['my-profile', slug], () => api.myProfile(slug).get());
  return (
    <div className="grid min-w-0 gap-4">
      <PortalPageHeader
        title={
          <>
            My <span className="text-firm-accent">Profile</span>
          </>
        }
        subtitle="Manage your information, preferences, and account settings."
      />
      <PageState query={profile} isEmpty={() => false}>
        {(p) => <ProfileContent key={p.portalRole} slug={slug} profile={p} />}
      </PageState>
    </div>
  );
}

function ProfileContent({ slug, profile: p }: { slug: string; profile: MyProfile }) {
  const primary = p.portalRole === 'PRIMARY';
  const nameOnly = p.portalRole === 'AUTHORIZED';
  const [naming, setNaming] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(UpdateMyProfileRequest),
    defaultValues: valuesOf(p),
  });
  const save = useApiMutation((body: Values) => api.myProfile(slug).update(body), {
    invalidate: ['my-profile', slug],
  });
  const errors = form.formState.errors;
  const initials = p.fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  const dob = p.dateOfBirth
    ? new Date(`${p.dateOfBirth}T12:00:00`).toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric',
      })
    : p.dateOfBirthUnavailable
      ? 'Unavailable right now. Ask your firm.'
      : 'Not on file';

  return (
    <>
      <form
        id="profile-form"
        noValidate
        data-testid="profile-form"
        className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2"
        onSubmit={form.handleSubmit((values) => save.mutate(values))}
      >
        <div className="grid min-w-0 content-start gap-4">
          <Card className="grid min-w-0 content-start gap-4">
            <div className="flex items-center gap-3">
              <span
                role="img"
                aria-label={`Profile initials: ${initials}`}
                className="grid size-14 shrink-0 place-items-center rounded-full bg-folder-surface font-display text-xl font-bold text-firm-text"
              >
                {initials}
              </span>
              <div>
                <h2 className="font-display text-xl font-bold text-heading">Account Information</h2>
                <p className="text-sm text-muted">
                  Keep your information current so we can serve you better.
                </p>
              </div>
            </div>
            <fieldset className="grid gap-3" disabled={!primary || save.isPending}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Locked
                  label="Full Name"
                  value={p.fullName}
                  hint="Name changes must be requested through our team."
                />
                {!nameOnly && <Locked label="Date of Birth" value={dob} />}
              </div>
              {nameOnly ? (
                <p className="text-sm text-muted">Your access shows the client&apos;s name only.</p>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input label="Email Address" value={p.email} readOnly disabled />
                    <div className="grid gap-2">
                      <Input
                        label="Mailing Address"
                        autoComplete="address-line1"
                        {...form.register('address.line1')}
                      />
                      <Input
                        label="Apt, Suite, etc. (optional)"
                        autoComplete="address-line2"
                        {...form.register('address.line2')}
                      />
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      label="Phone Number"
                      type="tel"
                      autoComplete="tel"
                      error={errors.phone?.message}
                      {...form.register('phone')}
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <Input
                        label="City"
                        autoComplete="address-level2"
                        {...form.register('address.city')}
                      />
                      <Input
                        label="State"
                        autoComplete="address-level1"
                        {...form.register('address.state')}
                      />
                      <Input
                        label="ZIP Code"
                        autoComplete="postal-code"
                        error={errors.address?.postalCode?.message}
                        {...form.register('address.postalCode')}
                      />
                    </div>
                  </div>
                  {save.isError && (
                    <p role="alert" className="text-sm text-danger">
                      {errorMessage(save.error, PROFILE_ERRORS)}
                    </p>
                  )}
                  {save.isSuccess && (
                    <p role="status" className="text-sm text-success">
                      Your changes were saved.
                    </p>
                  )}
                  {primary ? (
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit" variant="dark">
                        <Save aria-hidden className="size-5" /> Save Changes
                      </Button>
                      <Button
                        variant="secondary"
                        className="border-firm-primary text-firm-text hover:bg-folder-surface"
                        onClick={() => setNaming(true)}
                      >
                        <Pencil aria-hidden className="size-5" /> Request Name Change
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted">
                      Only the main account holder can change these.
                    </p>
                  )}
                </>
              )}
            </fieldset>
          </Card>
          <Card className="grid min-w-0 content-start gap-3">
            <SectionHeading
              icon={FileText}
              title="Additional Information"
              subtitle="Help us keep your records accurate."
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                disabled={!primary || save.isPending}
                label="Preferred Contact Method"
                options={[
                  { value: '', label: 'No preference' },
                  { value: 'EMAIL', label: 'Email' },
                  { value: 'PHONE', label: 'Phone' },
                  { value: 'TEXT', label: 'Text message' },
                ]}
                {...form.register('preferredContactMethod')}
              />
              <Input
                disabled={!primary || save.isPending}
                label="How did you hear about us?"
                placeholder="Select an option"
                {...form.register('referralSource')}
              />
            </div>
            <label className="grid gap-1 text-sm font-medium text-text">
              Notes (optional)
              <textarea
                rows={3}
                disabled={!primary || save.isPending}
                placeholder="Add any additional information here..."
                className={textareaClass}
                {...form.register('additionalInfo')}
              />
            </label>
          </Card>
        </div>
        <div className="grid min-w-0 content-start gap-4">
          <NotificationPreferencesCard slug={slug} />
          <LoginSecurityCard slug={slug} />
          <CancelAccountCard />
        </div>
      </form>
      <div className="[&_.ui-dialog>div>button]:text-firm-text">
        <NameChangeDialog slug={slug} open={naming} onClose={() => setNaming(false)} />
      </div>
    </>
  );
}

function LoginSecurityCard({ slug }: { slug: string }) {
  return (
    <Card className="grid gap-3 bg-folder-surface">
      <SectionHeading
        icon={LockKeyhole}
        title="Login & Security"
        subtitle="Update your password and security settings."
      />
      <VisualPasswordField label="Current Password" placeholder="Enter your current password" />
      <VisualPasswordField label="New Password" placeholder="Enter your new password" />
      <VisualPasswordField label="Confirm New Password" placeholder="Confirm your new password" />
      <Link
        className="inline-flex min-h-11 items-center justify-center rounded-control bg-firm-button px-4 py-2 text-sm font-medium text-on-firm-button hover:bg-firm-button-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-firm-primary"
        href={`/${slug}/forgot-password`}
      >
        Update Password
      </Link>
    </Card>
  );
}

function VisualPasswordField({ label, placeholder }: { label: string; placeholder: string }) {
  return (
    <div className="grid gap-1 text-sm">
      <span className="font-medium text-text">{label}</span>
      <span className="flex min-h-11 items-center justify-between gap-2 rounded-control border border-border bg-surface px-3 py-2 text-base text-muted">
        {placeholder}
        <EyeOff aria-hidden className="size-4 shrink-0 text-firm-text" />
      </span>
    </div>
  );
}

function SectionHeading({
  icon: Icon,
  title,
  subtitle,
  danger = false,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  danger?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={`grid size-12 shrink-0 place-items-center rounded-full ${danger ? 'bg-surface text-danger' : 'bg-folder-surface text-firm-text'}`}
      >
        <Icon aria-hidden className="size-7" />
      </span>
      <div>
        <h2 className={`font-display text-xl font-bold ${danger ? 'text-danger' : 'text-heading'}`}>
          {title}
        </h2>
        <p className="text-sm text-muted">{subtitle}</p>
      </div>
    </div>
  );
}

function CancelAccountCard() {
  return (
    <Card className="grid content-start gap-3 border-danger bg-danger-soft">
      <SectionHeading
        danger
        icon={Trash2}
        title="Cancel My Client Portal Account"
        subtitle="This will remove your access to the client portal."
      />
      <div className="flex gap-3 rounded-control border border-danger bg-surface/70 p-3 text-sm text-text">
        <AlertCircle aria-hidden className="size-6 shrink-0 text-danger" />
        <p>
          Canceling your client portal account does not automatically cancel any monthly
          subscriptions. Please send an email to cancel subscriptions. This option only cancels your
          access to the client portal.
        </p>
      </div>
      <div
        aria-hidden="true"
        className="flex min-h-11 items-center justify-center rounded-control bg-danger px-4 py-2 text-sm font-medium text-white"
      >
        Cancel My Client Portal Account
      </div>
    </Card>
  );
}

function Locked({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="grid min-w-0 content-start gap-1 text-sm">
      <span className="font-medium text-text">{label}</span>
      <span className="flex min-w-0 items-center justify-between gap-2 rounded-control border border-border bg-folder-surface px-3 py-2 text-base text-muted">
        <span className="truncate">{value}</span>
        <Lock aria-label="Locked" className="size-4 shrink-0" />
      </span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}
