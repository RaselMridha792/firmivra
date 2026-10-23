'use client';

import { X } from '@phosphor-icons/react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './button';

export interface DrawerProps {
  open: boolean;
  title: string;
  subtitle?: string;
  /** The button row pinned to the bottom. */
  footer?: ReactNode;
  children: ReactNode;
  onClose: () => void;
  /** `wide` (about 1024 px) for a whole builder, such as Create Campaign on Leads; `md` otherwise. */
  size?: 'md' | 'wide';
}

/** A panel that slides in from the right edge; the native dialog gives the focus trap and Escape. */
export function Drawer({
  open,
  title,
  subtitle,
  footer,
  children,
  onClose,
  size = 'md',
}: DrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    return () => {
      if (element.open) element.close();
    };
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={onClose}
      onClick={(event) => event.target === event.currentTarget && onClose()}
      className={`ui-drawer ml-auto h-full max-h-full w-full ${size === 'wide' ? 'max-w-5xl' : 'max-w-md'} bg-transparent p-0 text-text`}
    >
      <div className="flex h-full flex-col bg-surface shadow-lg">
        <div
          className={`flex justify-between gap-4 border-b border-divider p-5 ${subtitle ? 'items-start' : 'items-center'}`}
        >
          <div>
            <h2 id={titleId} className="text-xl font-bold text-heading">
              {title}
            </h2>
            {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
          </div>
          <Button variant="ghost" onClick={onClose} aria-label="Close panel">
            <X aria-hidden weight="bold" className="size-5" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer ? (
          <div className="flex justify-end gap-3 border-t border-divider p-5">{footer}</div>
        ) : null}
      </div>
    </dialog>
  );
}
