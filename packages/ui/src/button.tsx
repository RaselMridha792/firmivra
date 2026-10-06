import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant =
  'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'link' | 'public';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-action text-on-action hover:bg-action-hover active:bg-action-pressed',
  secondary:
    'border border-border bg-surface text-text hover:bg-canvas disabled:text-muted disabled:hover:bg-surface',
  ghost: 'text-link hover:bg-folder-surface',
  outline: 'border border-control-border text-link hover:bg-folder-surface',
  danger: 'bg-danger text-white hover:opacity-90',
  link: 'text-link underline underline-offset-2',
  public:
    'bg-public-action text-on-public-action hover:bg-public-action-hover active:bg-public-action-pressed',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  children,
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-control px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-disabled disabled:text-disabled-text ${size === 'sm' ? 'min-h-9 py-2' : size === 'lg' ? 'min-h-12 py-3' : 'min-h-11 py-2'} ${variants[variant]} ${className}`}
      {...props}
    >
      {loading ? <span aria-hidden="true">↻</span> : null}
      {children}
    </button>
  );
}
