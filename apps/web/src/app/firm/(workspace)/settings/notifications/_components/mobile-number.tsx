'use client';

import type { StaffPhoneState } from '@firmivra/types';
import { Badge, Button, Input, Skeleton } from '@firmivra/ui';
import { CheckCircle, DeviceMobile } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { NOT_LOADED, Quiet, SettingsCard } from '../../_components/settings-parts';

const PHONE = ['staff-phone'];
/** The preferences' key (notifications-screen.tsx): a verified number offers texts there. */
const PREFERENCES = ['notifications', 'preferences'];

const PHONE_ERRORS: Record<string, string> = {
  NO_PHONE: 'Your staff record has no mobile number. Ask an administrator to add it.',
  CODE_WAIT: 'A code was sent less than a minute ago. Wait a moment, then send another.',
  CODE_LIMIT: 'No more codes can be sent today. Try again tomorrow.',
  CODE_INVALID:
    'That code is not right, has expired or was already used. Check the text or send a new code.',
  PHONE_CHANGED: 'Your mobile number changed after the code was sent. Send a new code.',
  SEND_FAILED: 'The text could not be sent. Try again in a minute.',
  VALIDATION_FAILED: 'Enter the 6-digit code from the text.',
};

/** A US number as (770) 555-0123; any other number as it is. */
const formatPhone = (value: string) => {
  const us = value.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return us ? `(${us[1]}) ${us[2]}-${us[3]}` : value;
};
const dateText = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { dateStyle: 'medium' });

/** Seconds until `iso`, ticking each second; 0 once it has passed or when there is none. */
function useSecondsUntil(iso: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [iso]);
  return iso ? Math.max(0, Math.ceil((Date.parse(iso) - now) / 1000)) : 0;
}

/**
 * Mobile Number (R60's column requests 9 and 13): the number on the member's staff record and
 * whether they proved they hold it. Send Code texts a 6-digit code (one a minute); a right code
 * verifies the number and the preferences below then offer text messages. A new number on the
 * staff record clears the verification. Administrators set the number in Staff Management.
 */
export function MobileNumberCard() {
  const phone = useApiQuery(PHONE, () => api.staffPhone.get());
  return (
    <SettingsCard
      title="Mobile Number"
      subtitle="Verify your mobile number to choose text messages for your notices."
      icon={DeviceMobile}
      testId="mobile-number"
    >
      {phone.data ? (
        <MobileNumber state={phone.data} />
      ) : phone.isPending ? (
        <Skeleton className="h-20" />
      ) : (
        <Quiet>{NOT_LOADED}</Quiet>
      )}
    </SettingsCard>
  );
}

function MobileNumber({ state }: { state: StaffPhoneState }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const wait = useSecondsUntil(state.resendAt);
  const send = useApiMutation(() => api.staffPhone.sendCode(), { invalidate: PHONE });
  const verify = useApiMutation((value: string) => api.staffPhone.verify({ code: value }), {
    invalidate: PHONE,
  });
  const error = send.error ?? verify.error;

  if (!state.phone) {
    return (
      <Quiet>
        Your staff record has no mobile number. Ask an administrator to add it in Staff Management,
        then verify it here.
      </Quiet>
    );
  }
  const number = (
    <span className="text-base font-semibold text-heading">{formatPhone(state.phone)}</span>
  );
  if (state.verifiedAt) {
    return (
      <div className="flex flex-wrap items-center gap-3" data-testid="mobile-verified">
        {number}
        <Badge tone="success" icon={CheckCircle}>
          Verified
        </Badge>
        <span className="text-sm text-muted">since {dateText(state.verifiedAt)}</span>
      </div>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    send.reset();
    verify.mutate(code, {
      onSuccess: () => {
        setCode('');
        void queryClient.invalidateQueries({ queryKey: PREFERENCES });
      },
    });
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {number}
        <Badge tone="warning">Not verified</Badge>
      </div>
      <p className="text-sm text-text">
        {state.codeSent
          ? `We sent a 6-digit code to ${formatPhone(state.phone)}. It works for 10 minutes.`
          : 'We text a 6-digit code to this number. Standard message rates may apply.'}
      </p>
      {state.codeSent ? (
        <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
          <div className="w-48">
            <Input
              label="Code from the text *"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={verify.isPending}>
            {verify.isPending ? 'Verifying…' : 'Verify'}
          </Button>
        </form>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant={state.codeSent ? 'secondary' : 'primary'}
          disabled={send.isPending || wait > 0}
          onClick={() => {
            verify.reset();
            send.mutate(undefined);
          }}
        >
          {send.isPending ? 'Sending…' : state.codeSent ? 'Send a New Code' : 'Send Code'}
        </Button>
        {wait > 0 ? (
          <span className="text-sm text-muted" role="status">
            You can send another code in {wait} s.
          </span>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(error, PHONE_ERRORS)}
        </p>
      ) : null}
    </div>
  );
}
