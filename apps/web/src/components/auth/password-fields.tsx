import type { UseFormRegisterReturn } from 'react-hook-form';
import { PASSWORD_RULES } from '@firmivra/types';
import { Input } from '@firmivra/ui';
export function PasswordFields({
  field,
  password,
  error,
  confirm,
  onConfirm,
}: {
  field: UseFormRegisterReturn;
  password: string;
  error?: string;
  confirm: string;
  onConfirm: (value: string) => void;
}) {
  return (
    <>
      <Input
        label="New password"
        type="password"
        autoComplete="new-password"
        maxLength={256}
        error={error}
        {...field}
      />
      <Input
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => onConfirm(e.target.value)}
        required
        maxLength={256}
      />
      <ul className="space-y-1 text-sm" aria-label="Password rules">
        {PASSWORD_RULES.map((rule) => (
          <li key={rule.id} className={rule.test(password) ? 'text-success' : 'text-muted'}>
            {rule.test(password) ? '✓' : '○'} {rule.label}
          </li>
        ))}
      </ul>
    </>
  );
}
