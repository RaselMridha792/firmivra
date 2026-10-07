'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './button';

/** Native modal supplies focus trap, Escape, inert background and focus restoration. */
interface ModalProps {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}
export function Modal({ open, title, children, onClose }: ModalProps) {
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
      className="ui-dialog m-auto overflow-auto rounded-xl border border-border bg-surface p-6 text-text shadow-lg"
    >
      <div className="mb-6 flex items-center justify-between gap-4">
        <h2 id={titleId} className="text-2xl font-bold text-heading">
          {title}
        </h2>
        <Button variant="ghost" onClick={onClose} aria-label="Close dialog">
          ×
        </Button>
      </div>
      {children}
    </dialog>
  );
}
