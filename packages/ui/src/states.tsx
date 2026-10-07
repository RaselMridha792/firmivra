import type { ReactNode, HTMLAttributes } from 'react';
import { Button } from './button';
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
      className={`h-4 animate-pulse rounded-control bg-disabled motion-reduce:animate-none ${className}`}
      {...props}
    />
  );
}
export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="status"
      className={`flex items-center justify-between gap-4 rounded-card p-4 shadow-md bg-success-soft text-success`}
    >
      <span>{message}</span>
      <Button variant="ghost" onClick={onDismiss} aria-label="Dismiss notification">
        ×
      </Button>
    </div>
  );
}
