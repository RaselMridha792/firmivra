'use client';

import { Badge } from '@firmivra/ui';
import { CaretRight, DotsThree, DotsThreeVertical } from '@phosphor-icons/react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  TICKET_STATUSES,
  type SupportTicket,
  type TicketStatus,
} from '../../../../../mocks/admin-support';
import { PRIORITY_DOTS, PRIORITY_TONES, STATUS_TONES } from './support-data';

/** Home > Support > …; the last item is the current page. */
export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-2 text-sm text-muted">
        {items.map((item, index) => (
          <li key={item.label} className="flex items-center gap-2">
            {index > 0 ? <CaretRight aria-hidden weight="bold" className="size-3" /> : null}
            {item.href ? (
              <Link href={item.href} className="hover:text-action hover:underline">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-link">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function StatusBadge({ status }: { status: TicketStatus }) {
  return <Badge tone={STATUS_TONES[status]}>{TICKET_STATUSES[status]}</Badge>;
}

export function PriorityBadge({ priority }: { priority: SupportTicket['priority'] }) {
  return <Badge tone={PRIORITY_TONES[priority.color]}>{priority.name}</Badge>;
}

/** The coloured dot of a priority or status. */
export function Dot({ className }: { className: string }) {
  return (
    <span aria-hidden className={`inline-block size-2.5 shrink-0 rounded-full ${className}`} />
  );
}
export function PriorityDot({ priority }: { priority: SupportTicket['priority'] }) {
  return <Dot className={PRIORITY_DOTS[priority.color]} />;
}

/** A frame's quiet line: empty, unreachable or no permission. */
export function QuietLine({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p data-testid={testId} className="px-4 py-6 text-center text-sm text-muted">
      {children}
    </p>
  );
}

/** A white card of the Support pages. */
export function Panel({
  children,
  className = '',
  label,
  testId,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
  testId?: string;
}) {
  return (
    <section
      aria-label={label}
      data-testid={testId}
      className={`min-w-0 rounded-xl border border-divider bg-surface shadow-sm ${className}`}
    >
      {children}
    </section>
  );
}

/** The result of the last action, above the page's content. */
export function ResultLine({ message, error }: { message: string; error?: string }) {
  if (!message && !error) return null;
  return (
    <p
      role={error ? 'alert' : 'status'}
      data-testid="support-result"
      className={`rounded-lg px-4 py-3 text-sm ${error ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'}`}
    >
      {error ?? message}
    </p>
  );
}

export interface RowMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

/**
 * The design's "•••" (rows) and "⋮" (cards, messages) menus. The kit's ActionMenu adds a caret
 * and a framed button, which these don't have. Arrow keys move, Escape closes.
 */
export function RowMenu({
  label,
  items,
  vertical,
}: {
  label: string;
  items: RowMenuItem[];
  vertical?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const away = (event: MouseEvent) =>
      rootRef.current && !rootRef.current.contains(event.target as Node) && setOpen(false);
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  function key(event: React.KeyboardEvent) {
    const all = [...(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = all.indexOf(document.activeElement as HTMLElement);
    const move = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 }[event.key];
    if (event.key === 'Escape') {
      setOpen(false);
      rootRef.current?.querySelector<HTMLElement>('button')?.focus();
    } else if (move !== undefined) {
      event.preventDefault();
      all[(move + all.length) % all.length]?.focus();
    }
  }
  if (items.length === 0) return null;
  const Icon = vertical ? DotsThreeVertical : DotsThree;
  return (
    <div ref={rootRef} className="relative inline-block" onKeyDown={key}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        title={label}
        onClick={() => setOpen(!open)}
        className="inline-flex size-8 items-center justify-center rounded-lg text-heading hover:bg-canvas"
      >
        <Icon aria-hidden weight="bold" className="size-5" />
      </button>
      {open ? (
        <div
          id={id}
          role="menu"
          aria-label={label}
          className="absolute right-0 z-20 mt-1 flex w-48 flex-col rounded-lg border border-divider bg-surface py-1 text-left shadow-md"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={`min-h-9 px-3 text-left text-sm hover:bg-canvas focus:bg-canvas ${item.danger ? 'text-danger' : 'text-text'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
