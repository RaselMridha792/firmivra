'use client';

import { Button, Input, Skeleton } from '@firmivra/ui';
import { DeviceMobile } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import {
  formatPhone,
  MobileNumber,
  PHONE,
  PREFERENCES,
} from '../../settings/notifications/_components/mobile-number';

const SET_ERRORS: Record<string, string> = {
  VALIDATION_FAILED: 'Enter the phone number with its country code, for example +1 404 555 0123.',
};

/**
 * My Profile's mobile phone (Octavia's Overview guide of Oct 18, item 20): the member adds,
 * changes or removes their own number, then proves it with a code by text, as in My Settings. A
 * new number is not verified; text messages are offered only once it is.
 */
export function MyPhone() {
  const qc = useQueryClient();
  const phone = useApiQuery(PHONE, () => api.staffPhone.get());
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const save = useApiMutation((next: string | null) => api.staffPhone.set({ phone: next }), {
    invalidate: PHONE,
  });
  const done = () => {
    setEditing(false);
    // The notice channels depend on a verified number.
    void qc.invalidateQueries({ queryKey: PREFERENCES });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(value.trim(), { onSuccess: done });
  };
  const state = phone.data;
  return (
    <section
      aria-labelledby="my-phone-title"
      className="flex flex-col gap-3 border-t border-divider pt-5"
      data-testid="my-phone"
    >
      <h2 id="my-phone-title" className="flex items-center gap-2 font-semibold text-heading">
        <DeviceMobile aria-hidden weight="fill" className="size-5 text-action" />
        Mobile Phone
      </h2>
      {phone.isPending ? (
        <Skeleton className="h-16" />
      ) : !state ? (
        <p className="text-sm text-muted">Your mobile number could not be loaded. Try again.</p>
      ) : editing ? (
        <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
          <div className="w-64">
            <Input
              label="Mobile phone *"
              type="tel"
              autoComplete="tel"
              maxLength={30}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={save.isPending || !value.trim()}>
            {save.isPending ? 'Saving…' : 'Save Number'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              save.reset();
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <>
          {state.phone ? (
            <MobileNumber state={state} />
          ) : (
            <p className="text-sm text-text">
              {state.canChange
                ? 'No mobile number yet. Add one to get your notices by text once it is verified.'
                : "No mobile number yet. Your firm's Owner adds it in Staff Management."}
            </p>
          )}
          {/* Dashboard Review 2 (R2 NEW2): an employee's number is the Owner's to change. */}
          {state.canChange ? null : (
            <p className="text-sm text-muted" data-testid="phone-owner-note">
              Your firm&apos;s Owner can change this.
            </p>
          )}
          {state.canChange ? (
            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  save.reset();
                  setValue(state.phone ? formatPhone(state.phone) : '');
                  setEditing(true);
                }}
              >
                {state.phone ? 'Change Number' : 'Add Number'}
              </Button>
              {state.phone ? (
                <Button
                  variant="secondary"
                  disabled={save.isPending}
                  onClick={() => save.mutate(null, { onSuccess: done })}
                >
                  Remove Number
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
      {save.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(save.error, SET_ERRORS)}
        </p>
      ) : null}
    </section>
  );
}
