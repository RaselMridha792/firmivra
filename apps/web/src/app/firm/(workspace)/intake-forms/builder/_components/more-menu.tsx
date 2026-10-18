'use client';

import { DotsThreeVertical } from '@phosphor-icons/react';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';

export interface MoreMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

/**
 * The design's bare "⋮" button and its menu. The kit's ActionMenu draws a bordered button with a
 * caret, which the builder's rows and header don't have. Arrow keys move, Escape closes.
 */
export function MoreMenu({
  label,
  items,
  framed = false,
}: {
  label: string;
  items: MoreMenuItem[];
  /** A bordered square (next to the page's buttons) instead of the bare row icon. */
  framed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]:enabled')?.focus();
    const away = (event: MouseEvent) =>
      rootRef.current && !rootRef.current.contains(event.target as Node) && setOpen(false);
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  function key(event: KeyboardEvent) {
    const all = [
      ...(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:enabled') ?? []),
    ];
    const at = all.indexOf(document.activeElement as HTMLElement);
    const move = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 }[event.key];
    if (event.key === 'Escape') {
      setOpen(false);
      rootRef.current?.querySelector<HTMLElement>('button')?.focus();
    } else if (move !== undefined && all.length) {
      event.preventDefault();
      all[(move + all.length) % all.length]?.focus();
    }
  }
  return (
    <div ref={rootRef} className="relative inline-flex shrink-0" onKeyDown={key}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        title={label}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(!open);
        }}
        className={`flex items-center justify-center rounded-control text-heading hover:bg-canvas ${framed ? 'size-11 border border-border bg-surface' : 'size-9'}`}
      >
        <DotsThreeVertical aria-hidden weight="bold" className="size-5" />
      </button>
      {open ? (
        <div
          id={id}
          role="menu"
          aria-label={label}
          className="absolute top-full right-0 z-30 mt-1 flex w-52 flex-col rounded-xl border border-divider bg-surface p-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={item.disabled}
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                item.onSelect();
              }}
              className="min-h-9 rounded-md px-3 text-left text-sm text-text hover:bg-canvas focus:bg-canvas disabled:cursor-not-allowed disabled:text-muted"
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
