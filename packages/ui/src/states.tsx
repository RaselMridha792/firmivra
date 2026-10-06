import type { ReactNode, HTMLAttributes } from 'react';
import { Button } from './button';

export type Tone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';
const tones: Record<Tone, string> = {
  info: 'bg-info-soft text-info',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-disabled text-muted',
};
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center rounded-pill px-3 py-1 text-xs font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
export function Alert({
  title,
  children,
  tone = 'info',
}: {
  title: string;
  children?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={`rounded-card border border-current p-4 ${tones[tone]}`}
    >
      <p className="font-semibold">{title}</p>
      {children ? <div className="mt-2 text-sm">{children}</div> : null}
    </div>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-border bg-surface p-8 text-center">
      <span aria-hidden="true" className="text-3xl text-muted">
        ◇
      </span>
      <h2 className="text-lg font-semibold text-heading">{title}</h2>
      <p className="max-w-auth text-sm text-muted">{description}</p>
      {action}
    </div>
  );
}
export function Skeleton({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={`ui-skeleton h-4 animate-pulse rounded-control motion-reduce:animate-none ${className}`}
      {...props}
    />
  );
}
export function Toast({
  message,
  tone = 'success',
  onDismiss,
}: {
  message: string;
  tone?: Tone;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className={`flex items-center justify-between gap-4 rounded-card p-4 shadow-md ${tones[tone]}`}
    >
      <span>{message}</span>
      <Button variant="ghost" onClick={onDismiss} aria-label="Dismiss notification">
        ×
      </Button>
    </div>
  );
}
