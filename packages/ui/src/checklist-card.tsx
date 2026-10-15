import { CheckCircle, CheckSquare, Circle, Square, type Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { tileTones, tintTones, type TileTone } from './tones';

export interface ChecklistItem {
  id: string;
  label: ReactNode;
  /** Ticked. Leave out for a plain list ("Security Best Practices" are all ticked). */
  done?: boolean;
}

const surfaces = {
  plain: 'border border-border bg-surface',
  success: 'border border-success-soft bg-success-soft',
  info: 'bg-info-soft',
};

export interface ChecklistCardProps {
  title: string;
  items: ChecklistItem[];
  /** A tile beside the title (Security Best Practices' shield, What Happens Next?'s plane). */
  icon?: Icon;
  iconTone?: TileTone;
  /** Top right: "View All", "View Form". */
  action?: ReactNode;
  /**
   * `check`: green check circles (Settings Checklist, Submission Summary); `checkbox`: blue
   * ticked boxes (Security Best Practices); `number`: 1. 2. 3. (What Happens Next?).
   */
  marker?: 'check' | 'checkbox' | 'number';
  surface?: keyof typeof surfaces;
  /** Shown instead of the list when there are no items. */
  emptyText?: string;
  /** Extra content before the list, such as a progress ring. */
  aside?: ReactNode;
}

function Marker({
  marker,
  done,
  index,
}: {
  marker: ChecklistCardProps['marker'];
  done: boolean;
  index: number;
}) {
  if (marker === 'number') {
    return <span className="w-5 shrink-0 text-sm font-bold text-heading">{index + 1}.</span>;
  }
  if (marker === 'checkbox') {
    const Box = done ? CheckSquare : Square;
    return (
      <Box
        aria-hidden
        weight={done ? 'fill' : 'regular'}
        className={`size-5 shrink-0 ${done ? 'text-action' : 'text-control-border'}`}
      />
    );
  }
  const Dot = done ? CheckCircle : Circle;
  return (
    <Dot
      aria-hidden
      weight={done ? 'fill' : 'regular'}
      className={`size-5 shrink-0 ${done ? 'text-success' : 'text-control-border'}`}
    />
  );
}

/** A titled list of checks or steps. Unticked items read as not done to screen readers too. */
export function ChecklistCard({
  title,
  items,
  icon: Glyph,
  iconTone = 'green',
  action,
  marker = 'check',
  surface = 'plain',
  emptyText = 'Nothing to show yet.',
  aside,
}: ChecklistCardProps) {
  return (
    <section className={`flex flex-col gap-4 rounded-xl p-5 ${surfaces[surface]}`}>
      <header className="flex items-center gap-3">
        {Glyph ? (
          <span
            className={`flex size-11 shrink-0 items-center justify-center rounded-lg ${surface === 'plain' ? tileTones[iconTone] : tintTones[iconTone]}`}
          >
            <Glyph aria-hidden weight="fill" className="size-6" />
          </span>
        ) : null}
        <h3 className="flex-1 text-lg font-bold text-heading">{title}</h3>
        {action}
      </header>
      <div className="flex items-center gap-5">
        {aside}
        {items.length === 0 ? (
          <p className="text-sm text-muted">{emptyText}</p>
        ) : (
          <ul className="flex min-w-0 flex-1 flex-col gap-3">
            {items.map((item, index) => {
              const done = item.done ?? true;
              return (
                <li key={item.id} className="flex items-start gap-3 text-sm text-text">
                  <Marker marker={marker} done={done} index={index} />
                  <span className="min-w-0">
                    {item.label}
                    {marker === 'number' ? null : (
                      <span className="sr-only">{done ? ' (done)' : ' (not done)'}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
