'use client';

import { type MyProfile, UpdateMyProfileRequest } from '@firmivra/types';
import { Button, Card, Input, Select } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound, Lock, Save, UserRound } from 'lucide-react';
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

const textareaClass =
  'w-full rounded-control border border-border bg-surface px-3 py-2 text-base text-text focus-visible:outline-2 focus-visible:outline-focus disabled:bg-folder-surface';

/**
 * "My Profile" (docs/mockups/client-portal/My profile.png, N05). Name and date of birth are
 * locked (a name change is a request to the firm). Only the primary login edits; a spouse sees
 * the record, an authorized login sees the name only.
 */
export function ProfileScreen() {
  const { firmSlug: slug } = useParams<{ firmSlug: string }>();
  const profile = useApiQuery(['my-profile', slug], () => api.myProfile(slug).get());
  return (
    <div className="grid min-w-0 grid-cols-1 gap-6">
      <header>
        <h1 className="font-display text-4xl font-bold text-heading">My Profile</h1>
        <p className="text-text">Manage your information, preferences, and account settings.</p>
      </header>
      <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-2">
        <PageState query={profile} isEmpty={() => false}>
          {(p) => <AccountCard key={p.portalRole} slug={slug} profile={p} />}
        </PageState>
        <div className="grid min-w-0 content-start gap-6">
          <NotificationPreferencesCard slug={slug} />
          <Card className="grid gap-3">
            <h2 className="flex items-center gap-2 font-display text-2xl font-bold text-heading">
              <KeyRound aria-hidden className="size-6 text-firm-primary" /> Login &amp; Security
            </h2>
            <p className="text-sm text-text">
              To change your password, we email you a 6-digit code first.
            </p>
            <Link className="text-link underline" href={`/${slug}/forgot-password`}>
              Change my password
            </Link>
          </Card>
        </div>
      </div>
    </div>
  );
}

function AccountCard({ slug, profile: p }: { slug: string; profile: MyProfile }) {
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
  return (
    <Card className="grid min-w-0 content-start gap-4">
      <h2 className="flex items-center gap-2 font-display text-2xl font-bold text-heading">
        <UserRound aria-hidden className="size-6 text-firm-primary" /> Account Information
      </h2>
      <p className="text-sm text-muted">
        Keep your information current so we can serve you better.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <Locked
          label="Full Name"
          value={p.fullName}
          hint="Name changes must be requested through our team."
        />
        {nameOnly ? null : (
          <Locked
            label="Date of Birth"
            value={
              (p.dateOfBirth
                ? new Date(`${p.dateOfBirth}T12:00:00`).toLocaleDateString('en-US', {
                    month: '2-digit',
                    day: '2-digit',
                    year: 'numeric',
                  })
                : null) ??
              (p.dateOfBirthUnavailable ? 'Unavailable right now. Ask your firm.' : 'Not on file')
            }
          />
        )}
      </div>
      {nameOnly ? (
        <p className="text-sm text-muted">Your access shows the client&apos;s name only.</p>
      ) : (
        <form
          noValidate
          data-testid="profile-form"
          className="grid gap-4"
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
        >
          <fieldset className="contents" disabled={!primary || save.isPending}>
            <Input label="Email Address" value={p.email} readOnly disabled />
            <Input
              label="Phone Number"
              type="tel"
              autoComplete="tel"
              error={errors.phone?.message}
              {...form.register('phone')}
            />
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
            <div className="grid gap-4 md:grid-cols-3">
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
            <h3 className="font-display text-xl font-bold text-heading">Additional Information</h3>
            <div className="grid gap-4 md:grid-cols-2">
              <Select
                label="Preferred Contact Method"
                options={[
                  { value: '', label: 'No preference' },
                  { value: 'EMAIL', label: 'Email' },
                  { value: 'PHONE', label: 'Phone' },
                  { value: 'TEXT', label: 'Text message' },
                ]}
                {...form.register('preferredContactMethod')}
              />
              <Input label="How did you hear about us?" {...form.register('referralSource')} />
            </div>
            <label className="grid gap-1 text-sm font-medium text-text">
              Notes (optional)
              <textarea rows={3} className={textareaClass} {...form.register('additionalInfo')} />
            </label>
            {save.isError ? (
              <p role="alert" className="text-sm text-danger">
                {errorMessage(save.error, PROFILE_ERRORS)}
              </p>
            ) : null}
            {save.isSuccess ? (
              <p role="status" className="text-sm text-success">
                Your changes were saved.
              </p>
            ) : null}
            {primary ? (
              <div className="flex flex-wrap gap-2">
                <Button type="submit">
                  <Save aria-hidden className="size-5" /> Save Changes
                </Button>
                <Button variant="secondary" onClick={() => setNaming(true)}>
                  Request Name Change
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted">Only the main account holder can change these.</p>
            )}
          </fieldset>
        </form>
      )}
      <NameChangeDialog slug={slug} open={naming} onClose={() => setNaming(false)} />
    </Card>
  );
}

function Locked({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="grid content-start gap-1 text-sm">
      <span className="font-medium text-text">{label}</span>
      <span className="flex items-center justify-between gap-2 rounded-control border border-border bg-folder-surface px-3 py-2 text-base text-muted">
        {value}
        <Lock aria-label="Locked" className="size-4 shrink-0" />
      </span>
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}
