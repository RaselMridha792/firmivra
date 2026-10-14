import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** The tile before the title (module pages). */
  icon?: Icon;
  /** Breadcrumb or "Back to Clients" link above the title. */
  above?: ReactNode;
  /** Buttons on the right; the primary one last. */
  actions?: ReactNode;
}

/** The top of a page: optional tile, serif title, one-line subtitle and the page's buttons. */
export function PageHeader({ title, subtitle, icon: Glyph, above, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-2">
      {above}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          {Glyph ? (
            <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-action text-on-action">
              <Glyph aria-hidden weight="fill" className="size-8" />
            </span>
          ) : null}
          <div>
            <h1 className="font-display text-3xl font-bold text-heading">{title}</h1>
            {subtitle ? <p className="text-base text-muted">{subtitle}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
      </div>
    </header>
  );
}
