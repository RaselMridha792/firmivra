'use client';

import { CaretDown, CaretRight, Lock, type Icon } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface ActionMenuItem {
  label: string;
  icon?: Icon;
  onSelect: () => void;
  danger?: boolean;
  /** Shows a chevron: the choice opens a second list. */
  submenu?: boolean;
  /** "Admin Only": a lock and this text, in red, at the end of the row. */
  restricted?: string;
}
export interface ActionMenuSection {
  /** "COMMUNICATION" or "Send & Collect". */
  title?: string;
  items: ActionMenuItem[];
}
export interface ActionMenuProps {
  /** The trigger's content: a label, an icon, or both. */
  trigger: ReactNode;
  label: string;
  sections: ActionMenuSection[];
  /** A note at the bottom ("Restricted Actions: ..."). */
  footer?: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}

/** A button that opens a grouped list of actions. Arrow keys move, Escape closes. */
export function ActionMenu({
  trigger,
  label,
  sections,
  footer,
  align = 'right',
  className = '',
}: ActionMenuProps) {
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
    const items = [...(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const move = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[event.key];
    if (event.key === 'Escape') {
      setOpen(false);
      rootRef.current?.querySelector<HTMLElement>('button')?.focus();
    } else if (move !== undefined) {
      event.preventDefault();
      items[(move + items.length) % items.length]?.focus();
    }
  }
  return (
    <div ref={rootRef} className={`relative inline-block ${className}`} onKeyDown={key}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        onClick={() => setOpen(!open)}
        className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-divider bg-surface px-3 text-sm font-semibold text-heading hover:bg-canvas"
      >
        {trigger}
        <CaretDown aria-hidden weight="bold" className="size-3.5" />
      </button>
      {open ? (
        <div
          id={id}
          role="menu"
          aria-label={label}
          className={`absolute top-full z-30 mt-1 max-h-[32rem] w-72 overflow-y-auto rounded-xl border border-divider bg-surface p-2 shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {sections.map((section, index) => (
            <div
              key={section.title ?? section.items[0]?.label}
              role="group"
              aria-label={section.title}
              className={index ? 'mt-1 border-t border-divider pt-1' : ''}
            >
              {section.title ? (
                <p className="px-3 py-1.5 text-xs font-medium tracking-wide text-muted uppercase">
                  {section.title}
                </p>
              ) : null}
              {section.items.map(
                ({ label: text, icon: Glyph, onSelect, danger, submenu, restricted }) => (
                  <button
                    key={text}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    onClick={() => {
                      onSelect();
                      if (!submenu) setOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-md px-3 py-1.5 text-left text-sm hover:bg-canvas focus-visible:bg-canvas ${danger ? 'text-danger' : 'text-text'}`}
                  >
                    {Glyph ? <Glyph aria-hidden weight="fill" className="size-4 shrink-0" /> : null}
                    <span className="flex-1">{text}</span>
                    {restricted ? (
                      <span className="flex items-center gap-1 text-xs font-medium text-danger">
                        <Lock aria-hidden weight="fill" className="size-3.5" />
                        {restricted}
                      </span>
                    ) : null}
                    {submenu ? <CaretRight aria-hidden weight="bold" className="size-3.5" /> : null}
                  </button>
                ),
              )}
            </div>
          ))}
          {footer ? (
            <div className="mt-2 rounded-lg bg-danger-soft p-3 text-xs text-text">{footer}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
