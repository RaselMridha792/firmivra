'use client';

import { Button, Modal } from '@firmivra/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { hasUnsavedChanges } from '../lib/unsaved';

/**
 * Asks before leaving a page with unsaved changes (Client Portal guide 7.1, CP-7.1): a link to
 * another page of the app (the sidebar, the Settings menu) and closing or reloading the tab. The
 * page's forms register their changes with `useUnsavedChanges`; Stay keeps every edit.
 */
export function LeaveGuard() {
  const router = useRouter();
  const [leaving, setLeaving] = useState<string | null>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!hasUnsavedChanges() || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.('a[href]');
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || link.download) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      // The same page (a hash or the same address) loses nothing.
      if (url.pathname === window.location.pathname && url.search === window.location.search)
        return;
      event.preventDefault();
      event.stopPropagation();
      setLeaving(`${url.pathname}${url.search}${url.hash}`);
    };
    const onUnload = (event: BeforeUnloadEvent) => {
      if (hasUnsavedChanges()) event.preventDefault();
    };
    // Capture: before Next's link handler navigates.
    document.addEventListener('click', onClick, true);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, []);

  if (!leaving) return null;
  return (
    <Modal
      open
      title="Leave without saving?"
      onClose={() => setLeaving(null)}
      footer={
        <>
          <Button variant="secondary" onClick={() => setLeaving(null)}>
            Stay on this page
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              const href = leaving;
              setLeaving(null);
              router.push(href);
            }}
          >
            Leave without saving
          </Button>
        </>
      }
    >
      <p className="text-sm text-text" data-testid="leave-guard">
        You have changes that are not saved. If you leave now, they are lost.
      </p>
    </Modal>
  );
}
