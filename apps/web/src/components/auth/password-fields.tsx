'use client';
import { useState } from 'react';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { PASSWORD_RULES } from '@firmivra/types';
import { Button, Input } from '@firmivra/ui';
import { Check, Circle, Eye, EyeOff, LockKeyhole } from 'lucide-react';

/** New password and its confirmation, one show/hide toggle, and the password rules checklist. */
export function PasswordFields({
  password,
  confirm,
  value,
  errors,
}: {
  password: UseFormRegisterReturn;
  confirm: UseFormRegisterReturn;
  /** The password typed so far, for the checklist. */
  value: string;
  errors: { password?: string; confirm?: string };
}) {
  const [show, setShow] = useState(false);
  const EyeIcon = show ? EyeOff : Eye;
  return (
    <>
      {(['password', 'confirm'] as const).map((name) => (
        <div key={name} className="auth-field relative">
          <Input
            label={name === 'password' ? 'New password' : 'Confirm password'}
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder={name === 'password' ? 'Create a password' : 'Type it again'}
            error={errors[name]}
            {...(name === 'password' ? password : confirm)}
          />
          <LockKeyhole
            aria-hidden="true"
            className="pointer-events-none absolute top-12 left-5 h-6 w-6 text-muted"
          />
          {name === 'password' ? (
            <Button
              className="absolute top-10 right-2"
              variant="ghost"
              aria-label={show ? 'Hide passwords' : 'Show passwords'}
              aria-pressed={show}
              onClick={() => setShow(!show)}
            >
              <EyeIcon aria-hidden="true" className="h-6 w-6" />
            </Button>
          ) : null}
        </div>
      ))}
      <ul aria-label="Password rules" className="grid gap-1 text-sm sm:grid-cols-2">
        {PASSWORD_RULES.map((rule) => {
          const met = rule.test(value);
          const Icon = met ? Check : Circle;
          return (
            <li
              key={rule.id}
              className={`flex items-center gap-2 ${met ? 'text-success' : 'text-muted'}`}
            >
              <Icon aria-hidden="true" className="size-4 shrink-0" />
              {rule.label}
              <span className="sr-only">{met ? ', done' : ', not yet'}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
