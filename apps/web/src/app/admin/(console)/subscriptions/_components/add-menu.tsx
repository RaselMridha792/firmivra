'use client';

import { Button } from '@firmivra/ui';
import { CaretDown, DownloadSimple, Flask, Plus } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

/**
 * The header's split button: "Add Subscription", and under the caret the manual trial enrollment
 * and the export. The kit's ActionMenu draws a white bordered trigger, so this one is local.
 */
export function AddMenu({
  onAdd,
  onTrial,
  onExport,
}: {
  onAdd: () => void;
  onTrial: () => void;
  onExport: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const away = (event: MouseEvent) =>
      rootRef.current && !rootRef.current.contains(event.target as Node) && setOpen(false);
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  function onKey(event: KeyboardEvent) {
    const items = [...(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const move = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[event.key];
    if (event.key === 'Escape') {
      setOpen(false);
      rootRef.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]')?.focus();
    } else if (move !== undefined && open && items.length) {
      event.preventDefault();
      items[(move + items.length) % items.length]?.focus();
    }
  }
  const items = [
    { label: 'Start Trial for Firm', icon: Flask, onSelect: onTrial },
    { label: 'Export Subscriptions', icon: DownloadSimple, onSelect: onExport },
  ];
  return (
    <div ref={rootRef} className="relative inline-flex" onKeyDown={onKey}>
      <Button onClick={onAdd} className="rounded-r-none!">
        <Plus aria-hidden weight="bold" className="size-5" />
        Add Subscription
      </Button>
      <Button
        aria-label="More ways to add"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen(!open)}
        className="rounded-l-none! border-l border-on-action/40 px-3!"
      >
        <CaretDown aria-hidden weight="bold" className="size-4" />
      </Button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="More ways to add"
          className="absolute top-full right-0 z-30 mt-1 w-60 rounded-xl border border-divider bg-surface p-2 shadow-lg"
        >
          {items.map(({ label, icon: Glyph, onSelect }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                setOpen(false);
                onSelect();
              }}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-text hover:bg-canvas focus-visible:bg-canvas"
            >
              <Glyph aria-hidden weight="fill" className="size-4 shrink-0 text-action" />
              {label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
