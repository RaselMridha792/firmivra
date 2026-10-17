'use client';

import { DotsThree, DotsThreeVertical } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';

export interface RowMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

/**
 * The design's square "⋯" button and its menu. The kit's ActionMenu adds a caret and a label to
 * its button, which the design's rows don't have. Arrow keys move, Escape closes. `vertical` draws
 * "⋮", as in users-and-role.jpg.
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
        className="inline-flex size-8 items-center justify-center rounded-lg border border-divider bg-surface text-heading hover:bg-canvas"
      >
        {vertical ? (
          <DotsThreeVertical aria-hidden weight="bold" className="size-5" />
        ) : (
          <DotsThree aria-hidden weight="bold" className="size-5" />
        )}
      </button>
      {open ? (
        <div
          id={id}
          role="menu"
          aria-label={label}
          className="absolute right-0 z-20 mt-1 flex w-48 flex-col rounded-lg border border-divider bg-surface py-1 shadow-md"
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
