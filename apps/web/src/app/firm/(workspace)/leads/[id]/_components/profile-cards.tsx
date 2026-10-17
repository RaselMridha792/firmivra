import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

/** A card of the Lead Profile: a blue tile with the card's icon, its title and a link on the right. */
export function CardFrame({
  icon: Glyph,
  title,
  action,
  children,
  testId,
}: {
  icon: Icon;
  title: string;
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="rounded-xl bg-surface p-4 shadow-md" data-testid={testId}>
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-action text-on-action"
          >
            <Glyph weight="fill" className="size-5" />
          </span>
          <h2 className="text-lg font-bold text-action">{title}</h2>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

/** The quiet panel a card shows with no data: an icon, a bold line and a smaller one. */
export function EmptyPanel({
  icon: Glyph,
  title,
  text,
  children,
}: {
  icon: Icon;
  title: string;
  text?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg bg-canvas px-4 py-8 text-center">
      <Glyph aria-hidden weight="fill" className="size-12 text-control-border" />
      <p className="text-base font-bold text-heading">{title}</p>
      {text ? <p className="text-sm text-muted">{text}</p> : null}
      {children}
    </div>
  );
}

export const linkClass = 'text-sm font-medium text-link underline';
export const outlineButton =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-control border border-action bg-surface px-4 text-sm font-medium text-action hover:bg-accent-soft';
