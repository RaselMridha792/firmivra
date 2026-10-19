'use client';

import { DotsThreeVertical, type Icon } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';

export interface TemplateMenuItem {
  label: string;
  icon: Icon;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/**
 * The card's small square "⋮" button and its menu. The kit's ActionMenu adds a caret and a label
 * to its button, which the design's cards don't have (as team/_components/row-menu.tsx). Arrow
 * keys move, Escape closes, a click outside closes.
 */
export function TemplateMenu({ label, items }: { label: string; items: TemplateMenuItem[] }) {
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
  function key(event: React.KeyboardEvent) {
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
    <div ref={rootRef} className="relative inline-block shrink-0" onKeyDown={key}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        title={label}
        onClick={() => setOpen(!open)}
        className="inline-flex size-7 items-center justify-center rounded-md border border-divider bg-surface text-heading hover:bg-canvas"
      >
        <DotsThreeVertical aria-hidden weight="bold" className="size-4" />
      </button>
      {open ? (
        <div
          id={id}
          role="menu"
          aria-label={label}
          className="absolute right-0 z-20 mt-1 flex w-48 flex-col rounded-lg border border-divider bg-surface py-1 shadow-md"
        >
          {items.map(({ label: text, icon: Glyph, onSelect, danger, disabled }) => (
            <button
              key={text}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={disabled}
              onClick={() => {
                setOpen(false);
                onSelect();
              }}
              className={`flex min-h-9 items-center gap-2 px-3 text-left text-sm hover:bg-canvas focus:bg-canvas disabled:cursor-not-allowed disabled:text-muted ${danger ? 'text-danger' : 'text-text'}`}
            >
              <Glyph aria-hidden weight="fill" className="size-4 shrink-0" />
              {text}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
