import { type TileTone, tileTones } from '@firmivra/ui';
import type { Icon } from '@phosphor-icons/react';
import { type ReactNode, createElement } from 'react';

/**
 * One card of Staff Account Access & Security: the tinted tile, the title, an optional line under
 * it, and an optional button or link on the right.
 */
export function Panel({
  title,
  subtitle,
  icon,
  tone = 'blue',
  action,
  testId,
  className = '',
  children,
}: {
  title: string;
  subtitle?: string;
  icon: Icon;
  tone?: TileTone;
  action?: ReactNode;
  testId?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      data-testid={testId}
      className={`flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm ${className}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span
          aria-hidden
          className={`flex size-11 shrink-0 items-center justify-center rounded-lg ${tileTones[tone]}`}
        >
          {createElement(icon, { weight: 'fill', className: 'size-6' })}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-heading">{title}</h2>
          {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
