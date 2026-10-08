'use client';

import { CreateInviteRequest, type FirmSettings } from '@firmivra/types';
import { Badge, Button, Card, Input, Select } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { UsersRound } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { PageState } from '../../../../components/page-state';
import { useMe } from '../../../../components/signed-in';
import { api } from '../../../../lib/api';
import { staffAuth } from '../../../../lib/auth';
import { errorMessage } from '../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../lib/query';
import { FIRM_SETTINGS, SETUP_ERRORS, TEAM, type StepProps } from './shared';
import { StepActions, StepTitle } from './step-form';

export const ROLE_LABELS = { OWNER: 'Owner', ADMIN: 'Admin', STAFF: 'Staff' } as const;

/** Step 3: who is on the team, and invites. Owners invite Admins or Staff; Admins invite Staff. */
export function TeamStep({ firm, onBack, onNext }: StepProps & { firm: FirmSettings }) {
  const { me } = useMe();
  const active = me.memberships.filter((m) => m.status === 'ACTIVE');
  const myRole = (active.find((m) => m.business.id === firm.business.id) ?? active[0])?.role;
  const team = useApiQuery(TEAM, () => api.team.list());
  const [draftSaved, setDraftSaved] = useState(false);
  const done = useApiMutation(() => api.settings.completeStep('team'), {
    invalidate: FIRM_SETTINGS,
  });

  return (
    <Card
      title={<StepTitle icon={UsersRound}>Team and access</StepTitle>}
      className="flex flex-col gap-4"
    >
      <p className="text-sm text-muted">
        Invite the people who work with you. Each one gets an email to set up their sign-in.
      </p>
      <PageState query={team}>
        {(members) => (
          <ul className="divide-y divide-border rounded-card border border-border">
            {members.map((member) => (
              <li
                key={member.id}
                data-testid="team-member"
                className="flex flex-wrap items-center justify-between gap-2 p-3"
              >
                <span className="min-w-0">
                  <span className="block font-medium text-text">{member.user.name}</span>
                  <span className="block break-all text-sm text-muted">{member.user.email}</span>
                </span>
                <span className="flex gap-2">
                  <Badge tone="info">{ROLE_LABELS[member.role]}</Badge>
                  {member.status === 'ACTIVE' ? null : <Badge>{member.status.toLowerCase()}</Badge>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PageState>
      <InviteForm roles={myRole === 'OWNER' ? ['ADMIN', 'STAFF'] : ['STAFF']} />
      <p className="text-sm text-muted">
        Owners and Admins manage the firm; Staff work with clients. Change roles later on Team.
      </p>
      {/* Invites save as they are sent, so Continue only marks the step done. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          done.mutate(undefined, { onSuccess: onNext });
        }}
      >
        <StepActions
          onBack={onBack}
          onSaveDraft={() => setDraftSaved(true)}
          pending={done.isPending}
        />
      </form>
      {draftSaved ? (
        <p role="status" className="text-sm text-success">
          Draft saved. Invites are sent as soon as you add them.
        </p>
      ) : null}
      {done.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(done.error, SETUP_ERRORS)}
        </p>
      ) : null}
    </Card>
  );
}

export function InviteForm({ roles }: { roles: ('ADMIN' | 'STAFF')[] }) {
  const form = useForm({
    resolver: zodResolver(CreateInviteRequest),
    defaultValues: { name: '', email: '', role: 'STAFF' as const },
  });
  const invite = useApiMutation((body: CreateInviteRequest) => staffAuth.createInvite(body), {
    invalidate: TEAM,
  });
  const errors = form.formState.errors;

  return (
    <form
      onSubmit={form.handleSubmit((body) => invite.mutate(body, { onSuccess: () => form.reset() }))}
      noValidate
      className="grid gap-3 rounded-card border border-border p-4 sm:grid-cols-2"
    >
      <Input label="Name" error={errors.name?.message} {...form.register('name')} />
      <Input label="Email" type="email" error={errors.email?.message} {...form.register('email')} />
      <Select
        label="Role"
        options={roles.map((role) => ({ value: role, label: ROLE_LABELS[role] }))}
        {...form.register('role')}
      />
      <div className="flex items-end">
        <Button type="submit" variant="secondary" disabled={invite.isPending}>
          {invite.isPending ? 'Inviting…' : 'Send invite'}
        </Button>
      </div>
      {invite.error ? (
        <p role="alert" className="text-sm text-danger sm:col-span-2">
          {errorMessage(invite.error)}
        </p>
      ) : null}
    </form>
  );
}
