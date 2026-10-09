import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function SectionTitle({
  icon: Icon,
  iconClassName = 'text-brand-700',
  children,
  action,
}: {
  icon: LucideIcon;
  /** The icon's colour; the mockup gives each card its own. */
  iconClassName?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-xl font-semibold text-brand-900">
        <Icon aria-hidden className={`size-6 ${iconClassName}`} />
        {children}
      </h2>
      {action}
    </div>
  );
}
