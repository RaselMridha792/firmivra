import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function SectionTitle({
  icon: Icon,
  iconClassName = 'text-brand-700',
  nowrap = false,
  children,
  action,
}: {
  icon: LucideIcon;
  /** The icon's colour; the mockup gives each card its own. */
  iconClassName?: string;
  /** Keep the action on the title row: the title's words wrap instead. */
  nowrap?: boolean;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`mb-4 flex items-center justify-between gap-3 ${nowrap ? '' : 'flex-wrap'}`}>
      <h2 className="flex min-w-0 items-center gap-2 text-xl font-semibold text-brand-900">
        <Icon aria-hidden className={`size-6 shrink-0 ${iconClassName}`} />
        <span className="min-w-0">{children}</span>
      </h2>
      {action}
    </div>
  );
}
