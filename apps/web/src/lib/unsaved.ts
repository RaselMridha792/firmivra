import { useEffect } from 'react';

// Forms that hold unsaved work register here, so a Back out of the page asks first (SH1).
const open = new Set<symbol>();

/** True while any form on the page has unsaved changes. */
export const hasUnsavedChanges = () => open.size > 0;

/** Registers this form's unsaved changes while `dirty` is true. */
export function useUnsavedChanges(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const token = Symbol('unsaved');
    open.add(token);
    return () => {
      open.delete(token);
    };
  }, [dirty]);
}
