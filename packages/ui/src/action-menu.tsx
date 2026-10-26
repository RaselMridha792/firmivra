'use client';

import { CaretDown, CaretRight, Lock, type Icon } from '@phosphor-icons/react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

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
  /** The trigger's content: a label, an icon, or both. The menu adds the one arrow itself. */
  trigger: ReactNode;
  label: string;
  sections: ActionMenuSection[];
  /** A note at the bottom ("Restricted Actions: ..."). */
  footer?: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}

/** Space kept between the menu and the trigger, and between the menu and the window's edges. */
const GAP = 4;
const EDGE = 8;
/** The tallest the menu grows before it scrolls inside (32rem). */
const MAX_HEIGHT = 512;

/**
 * Where the menu goes: below the trigger, or above it when there is more room there; aligned to
 * the trigger's right (or left) edge but always inside the window; never taller than the room.
 */
export function placeMenu(
  trigger: { top: number; bottom: number; left: number; right: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  align: 'left' | 'right',
): { top: number; left: number; maxHeight: number } {
  const below = viewport.height - trigger.bottom - GAP - EDGE;
  const above = trigger.top - GAP - EDGE;
  const up = menu.height > below && above > below;
  const maxHeight = Math.max(0, Math.min(MAX_HEIGHT, up ? above : below));
  const height = Math.min(menu.height, maxHeight);
  const top = up ? trigger.top - GAP - height : trigger.bottom + GAP;
  const wanted = align === 'right' ? trigger.right - menu.width : trigger.left;
  const left = Math.max(EDGE, Math.min(wanted, viewport.width - menu.width - EDGE));
  return { top, left, maxHeight };
}

/**
 * A button that opens a grouped list of actions. Arrow keys, Home and End move, Escape or a tab
 * away closes (focus back on the button). The list is drawn above the page (in the trigger's
 * dialog when it is in one), so a table's scroll area never clips it, and it stays inside the
 * window, scrolling inside itself when it is long.
 */
export function ActionMenu({
  trigger,
  label,
  sections,
  footer,
  align = 'right',
  className = '',
}: ActionMenuProps) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const open = host !== null;
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = (refocus: boolean) => {
    setHost(null);
    if (refocus) buttonRef.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const button = buttonRef.current;
      const menu = menuRef.current;
      if (!button || !menu) return;
      const at = placeMenu(
        button.getBoundingClientRect(),
        { width: menu.offsetWidth, height: menu.scrollHeight },
        { width: window.innerWidth, height: window.innerHeight },
        align,
      );
      menu.style.top = `${at.top}px`;
      menu.style.left = `${at.left}px`;
      menu.style.maxHeight = `${at.maxHeight}px`;
      menu.style.visibility = 'visible';
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const away = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setHost(null);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  function key(event: React.KeyboardEvent) {
    if (!open) return;
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const move = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[event.key];
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') {
      close(false);
    } else if (move !== undefined && items.length) {
      event.preventDefault();
      items[(move + items.length) % items.length]?.focus();
    }
  }

  const menu = (
    <div
      ref={menuRef}
      id={id}
      role="menu"
      aria-label={label}
      style={{ position: 'fixed', top: 0, left: 0, visibility: 'hidden' }}
      className="z-50 w-72 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-divider bg-surface p-2 shadow-lg"
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
                  if (!submenu) close(false);
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
  );

  return (
    <div ref={rootRef} className={`relative inline-block ${className}`} onKeyDown={key}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        onClick={(event) => {
          if (open) return close(false);
          setHost(event.currentTarget.closest('dialog') ?? document.body);
        }}
        className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-divider bg-surface px-3 text-sm font-semibold text-heading hover:bg-canvas"
      >
        {trigger}
        <CaretDown aria-hidden weight="bold" className="size-3.5" />
      </button>
      {host ? createPortal(menu, host) : null}
    </div>
  );
}
