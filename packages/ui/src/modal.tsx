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
    // The control that opened it gets focus back when it closes, however it closes: the browser
    // does this only for a dialog closed in place, and screens usually remove a closed dialog
    // from the page (Leads R2 14: Escape left focus on the page).
    const opener =
      open &&
      document.activeElement instanceof HTMLElement &&
      !element.contains(document.activeElement)
        ? document.activeElement
        : null;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
    return () => {
      if (element.open) element.close();
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Escape asks the parent, which closes by setting `open` (a form with unsaved changes can
        // ask first); the browser does not close the dialog on its own.
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (
          event.key === 'Tab' &&
          event.currentTarget.querySelectorAll(':enabled, a[href], [tabindex="0"]').length === 1
        )
          event.preventDefault();
      }}
      className="ui-dialog m-auto overflow-auto rounded-xl border border-border bg-surface p-6 text-text shadow-lg"
    >
      <div
        className={`mb-6 flex justify-between gap-4 ${subtitle ? 'items-start' : 'items-center'}`}
      >
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
