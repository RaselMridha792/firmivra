import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-action text-on-action hover:bg-action-hover disabled:bg-disabled disabled:text-disabled-text',
  secondary:
    'border border-border bg-surface text-text hover:bg-canvas disabled:text-muted disabled:hover:bg-surface',
  ghost: 'text-link hover:bg-folder-surface disabled:text-muted',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({
  variant = 'primary',
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
