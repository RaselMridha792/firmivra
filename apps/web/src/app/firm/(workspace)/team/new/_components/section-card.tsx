import type { Icon } from '@phosphor-icons/react';
import { createElement, type ReactNode } from 'react';

/** One numbered section of a Create Staff step: the tinted icon tile, "1. Title" and its line. */
export function SectionCard({
  id,
  number,
  title,
  subtitle,
  icon,
  children,
}: {
  id: string;
  number: number;
  title: string;
  subtitle: string;
  icon: Icon;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-4 rounded-xl border border-divider bg-surface p-4 shadow-sm"
    >
      <div className="flex items-center gap-4">
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-info-soft text-heading"
        >
          {createElement(icon, { weight: 'fill', className: 'size-7' })}
        </span>
        <div className="min-w-0">
          <h2 id={id} className="text-xl font-bold text-heading">
            {number}. {title}
          </h2>
          <p className="text-sm text-muted">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
