'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from '@phosphor-icons/react';
import { Button } from './button';

/** Native modal supplies focus trap, Escape, inert background and focus restoration. */
interface ModalProps {
  open: boolean;
  title: string;
  /** One line under the title. */
  subtitle?: string;
  /** The button row at the bottom (Cancel and the primary action). */
  footer?: ReactNode;
  children: ReactNode;
  onClose: () => void;
}
export function Modal({ open, title, subtitle, footer, children, onClose }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    return () => {
      if (element.open) element.close();
    };
  }, [open]);
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={onClose}
      onKeyDown={(event) => {
        if (
          event.key === 'Tab' &&
          event.currentTarget.querySelectorAll(':enabled, a[href], [tabindex="0"]').length === 1
        )
          event.preventDefault();
      }}
      className="ui-dialog m-auto overflow-auto rounded-xl border border-border bg-surface p-6 text-text shadow-lg"
    >
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 id={titleId} className="text-2xl font-bold text-heading">
            {title}
          </h2>
          {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
        </div>
        <Button variant="ghost" onClick={onClose} aria-label="Close dialog">
          <X aria-hidden weight="bold" className="size-5" />
        </Button>
      </div>
      {children}
      {footer ? <div className="mt-6 flex justify-end gap-3">{footer}</div> : null}
    </dialog>
  );
}
