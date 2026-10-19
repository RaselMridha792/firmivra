import { Card } from '@firmivra/ui';
import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

/** Page-local Card composition: the design has an unbanded header with a circular icon. */
export function SettingsSection({
  id,
  icon: Glyph,
  title,
  subtitle,
  children,
  className = '',
}: {
  id: string;
  icon: Icon;
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card
      id={id}
      data-testid={id}
      aria-labelledby={`${id}-title`}
      className={`min-w-0 scroll-mt-4 p-4! shadow-none! sm:p-4.5! ${className}`}
    >
      <div className="mb-4 flex items-center gap-3.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-info-soft text-action">
          <Glyph aria-hidden weight="fill" className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-base leading-5 font-bold text-heading">
            {title}
          </h2>
          {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
        </div>
      </div>
      {children}
    </Card>
  );
}
