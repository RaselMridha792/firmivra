'use client';

import { Button, Modal } from '@firmivra/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * Octavia's C10: before unsaved changes are lost, ask Save, Discard or Keep Editing. `values` is
 * everything the form would save (any value JSON can hold); the form is dirty while they differ
 * from what it opened with (or last saved, after `rebase()`). It catches the form's own leaving
 * (`leave(href)`: Cancel, Use Template), every in-app link (Back to Tasks, the sidebar) and the
 * browser's reload or close (its own prompt). The browser's Back button is not caught: the App
 * Router has no way to stop it.
 */
export function useUnsavedGuard(values: unknown) {
  const router = useRouter();
  const snapshot = JSON.stringify(values);
  const [baseline, setBaseline] = useState(snapshot);
  const [rebasing, setRebasing] = useState(false);
  if (rebasing) {
    setRebasing(false);
    setBaseline(snapshot);
  }
  const dirty = snapshot !== baseline;
  const [pending, setPending] = useState<string | null>(null);
  const leavingRef = useRef(false);

  useEffect(() => {
    if (!dirty) return;
    const unload = (e: BeforeUnloadEvent) => {
      if (leavingRef.current) return;
      e.preventDefault();
    };
    const click = (e: MouseEvent) => {
      if (leavingRef.current || e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest('a[href]');
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || link.download) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search)
        return;
      // Capture phase, before Next's Link: the visit waits for the person's answer.
      e.preventDefault();
      e.stopPropagation();
      setPending(`${url.pathname}${url.search}${url.hash}`);
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', unload);
      document.removeEventListener('click', click, true);
    };
  }, [dirty]);

  const go = (href: string) => {
    leavingRef.current = true;
    router.push(href);
  };
  return {
    dirty,
    /** Where the person was going when asked; null when no question is open. */
    pending,
    /** Leave now, or ask first when something is unsaved. */
    leave: (href: string) => (dirty ? setPending(href) : go(href)),
    /** Before the form navigates after a save: no question then. */
    allow: () => {
      leavingRef.current = true;
    },
    /** After a save that stays on the form (Save & Create Another): what it shows now is saved. */
    rebase: () => setRebasing(true),
    keepEditing: () => setPending(null),
    discard: () => {
      const href = pending;
      setPending(null);
      if (href) go(href);
    },
    close: () => setPending(null),
  };
}

/** The question itself: Keep Editing, Discard Changes, Save. */
export function UnsavedDialog({
  guard,
  onSave,
  saving,
}: {
  guard: ReturnType<typeof useUnsavedGuard>;
  onSave: () => void;
  saving: boolean;
}) {
  if (!guard.pending) return null;
  return (
    <Modal
      open
      title="Unsaved changes"
      subtitle="You have changes that are not saved yet."
      onClose={guard.keepEditing}
      footer={
        <>
          <Button variant="secondary" onClick={guard.keepEditing} data-testid="unsaved-keep">
            Keep Editing
          </Button>
          <Button variant="secondary" onClick={guard.discard} data-testid="unsaved-discard">
            Discard Changes
          </Button>
          <Button
            disabled={saving}
            onClick={() => {
              guard.close();
              onSave();
            }}
            data-testid="unsaved-save"
          >
            Save
          </Button>
        </>
      }
    >
      <p className="text-sm text-text">
        Save them, discard them and leave, or keep editing. If something is missing, Save keeps you
        here and shows what to fix.
      </p>
    </Modal>
  );
}
