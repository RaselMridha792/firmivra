'use client';

import { ApiRequestError, PASSWORD_RULES, type MySessionItem } from '@firmivra/types';
import { Badge, Button, Card, Input, Modal } from '@firmivra/ui';
import { CheckCircle, Circle, Key, ShieldCheck, SignOut } from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';

// SM14 part B (Octavia's Staff Management review of Oct 23, "Own sessions" and "Own password"):
// every staff member, whatever their role, signs out their own other sessions and changes their
// own password here. Self-contained, for My Profile (R55's piece of that page, the lead's
// placement of Nov 7). Someone else's sessions and password stay with Access & Security.

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const ERRORS = {
  PASSWORD_REJECTED: 'That password is not allowed. Choose another one.',
  RATE_LIMITED: 'Too many tries. Wait 15 minutes, then try again.',
};

function SessionRow({ s }: { s: MySessionItem }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-t border-divider py-3 first:border-t-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-heading">{s.device}</p>
        <p className="text-xs text-muted">
          {[s.place, s.ip].filter(Boolean).join(' · ') || 'Location unknown'}
        </p>
      </div>
      {s.current ? (
        <Badge tone="success" dot>
          This device
        </Badge>
      ) : (
        <span className="text-xs text-muted">
          {s.activeNow ? 'Active now' : `Last active ${when(s.lastActiveAt)}`}
        </span>
      )}
    </li>
  );
}

/** The new password's rules, each ticked once met. */
function Rules({ value }: { value: string }) {
  return (
    <ul aria-label="Password rules" className="grid gap-1 text-sm sm:grid-cols-2">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(value);
        const Icon = met ? CheckCircle : Circle;
        return (
          <li
            key={rule.id}
            className={`flex items-center gap-2 ${met ? 'text-success' : 'text-muted'}`}
          >
            <Icon aria-hidden weight={met ? 'fill' : 'regular'} className="size-4 shrink-0" />
            {rule.label}
            <span className="sr-only">{met ? ', done' : ', not yet'}</span>
          </li>
        );
      })}
    </ul>
  );
}

function ChangePassword({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [form, setForm] = useState({ current: '', next: '', again: '' });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof form, string>>>({});
  const save = useApiMutation(
    (body: { currentPassword: string; newPassword: string }) => api.mySecurity.changePassword(body),
    { invalidate: ['my-security'] },
  );
  const submit = () => {
    const found: typeof errors = {};
    if (!form.current) found.current = 'Enter your current password';
    if (!PASSWORD_RULES.every((rule) => rule.test(form.next)))
      found.next = 'Meet every rule below.';
    else if (form.next === form.current) found.next = 'Choose a password you are not using now';
    if (form.again !== form.next) found.again = 'The two new passwords are not the same';
    setErrors(found);
    if (Object.keys(found).length) return;
    save.mutate(
      { currentPassword: form.current, newPassword: form.next },
      {
        onSuccess: (r) =>
          onDone(
            `Your password was changed.${r.sessionsRevoked ? ` ${plural(r.sessionsRevoked, 'other session')} signed out.` : ''}`,
          ),
        onError: (e) => {
          const field = e instanceof ApiRequestError ? e.details?.[0] : undefined;
          if (field?.path === 'currentPassword') setErrors({ current: field.message });
        },
      },
    );
  };
  const failed =
    save.error &&
    !(save.error instanceof ApiRequestError && save.error.details?.[0]?.path === 'currentPassword')
      ? errorMessage(save.error, ERRORS)
      : '';
  return (
    <Modal
      open
      title="Change Password"
      subtitle="Enter your current password, then the new one twice. Your other sessions here are signed out."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending ? 'Changing…' : 'Change Password'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Input
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={form.current}
          error={errors.current}
          onChange={(e) => setForm((f) => ({ ...f, current: e.target.value }))}
        />
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          value={form.next}
          error={errors.next}
          onChange={(e) => setForm((f) => ({ ...f, next: e.target.value }))}
        />
        <Rules value={form.next} />
        <Input
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={form.again}
          error={errors.again}
          onChange={(e) => setForm((f) => ({ ...f, again: e.target.value }))}
        />
        {failed ? (
          <p role="alert" className="text-sm text-danger">
            {failed}
          </p>
        ) : null}
        {/* Enter submits; the footer's button does the same. */}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}

/**
 * Security on My Profile: my sessions at this firm with Sign Out All Other Sessions (this device
 * stays signed in; asks first), and Change Password (the current one first). Each is audited.
 */
export function MySecurityCard() {
  const sessions = useApiQuery(['my-security', 'sessions'], () => api.mySecurity.sessions());
  const signOut = useApiMutation(() => api.mySecurity.signOutOthers({ confirm: true }), {
    invalidate: ['my-security'],
  });
  const [asking, setAsking] = useState(false);
  const [changing, setChanging] = useState(false);
  const [done, setDone] = useState('');
  const list = sessions.data ?? [];
  const others = list.filter((s) => !s.current).length;
  return (
    <Card variant="elevated" className="flex flex-col gap-5" data-testid="my-security">
      <div className="flex items-start gap-3">
        <ShieldCheck aria-hidden weight="fill" className="size-6 shrink-0 text-action" />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-heading">Security</h2>
          <p className="text-sm text-muted">Your sessions at this firm, and your password.</p>
        </div>
      </div>

      <section aria-labelledby="my-sessions" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="my-sessions" className="text-sm font-semibold text-heading">
            Active sessions
          </h3>
          <Button
            variant="secondary"
            disabled={!others || signOut.isPending}
            onClick={() => {
              setDone('');
              setAsking(true);
            }}
          >
            <SignOut aria-hidden className="size-4" />
            Sign Out All Other Sessions
          </Button>
        </div>
        {sessions.isPending ? (
          <p className="text-sm text-muted">Loading your sessions…</p>
        ) : sessions.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(sessions.error)}
          </p>
        ) : list.length ? (
          <ul aria-label="Your sessions">
            {list.map((s) => (
              <SessionRow key={s.id} s={s} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No other sessions are open.</p>
        )}
      </section>

      <section
        aria-labelledby="my-password"
        className="flex flex-wrap items-center justify-between gap-2 border-t border-divider pt-4"
      >
        <div className="min-w-0">
          <h3 id="my-password" className="text-sm font-semibold text-heading">
            Password
          </h3>
          <p className="text-sm text-muted">Change it any time. You need the current one.</p>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            setDone('');
            setChanging(true);
          }}
        >
          <Key aria-hidden className="size-4" />
          Change Password
        </Button>
      </section>

      {done ? (
        <p role="status" data-testid="my-security-result" className="text-sm text-success">
          {done}
        </p>
      ) : signOut.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(signOut.error)}
        </p>
      ) : null}

      {asking ? (
        <Modal
          open
          title="Sign out of your other sessions?"
          subtitle={`${plural(others, 'other session')} at this firm will be signed out. This device stays signed in.`}
          onClose={() => setAsking(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setAsking(false)}>
                Cancel
              </Button>
              <Button
                disabled={signOut.isPending}
                onClick={() =>
                  signOut.mutate(undefined, {
                    onSuccess: (r) => {
                      setAsking(false);
                      setDone(`${plural(r.sessionsRevoked, 'other session')} signed out.`);
                    },
                  })
                }
              >
                Sign Out Other Sessions
              </Button>
            </>
          }
        >
          <p className="text-sm text-text">
            Anyone using your account on those devices must sign in again.
          </p>
        </Modal>
      ) : null}
      {changing ? (
        <ChangePassword
          onClose={() => setChanging(false)}
          onDone={(text) => {
            setChanging(false);
            setDone(text);
          }}
        />
      ) : null}
    </Card>
  );
}
