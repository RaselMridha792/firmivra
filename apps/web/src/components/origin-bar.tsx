'use client';

import { Button, Modal } from '@firmivra/ui';
import { ArrowLeft } from '@phosphor-icons/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { markReturn, ORIGIN_PARAM, originLabel, safeOrigin, takeScroll } from '../lib/origin';
import { hasUnsavedChanges } from '../lib/unsaved';

/** Tries for about two seconds, while the page's lists load, to reach the remembered position. */
function restoreScroll(y: number) {
  let tries = 0;
  const step = () => {
    const room = document.documentElement.scrollHeight - window.innerHeight;
    if (room >= y || tries >= 40) {
      window.scrollTo(0, Math.min(y, Math.max(room, 0)));
      return;
    }
    tries += 1;
    window.setTimeout(step, 50);
  };
  step();
}

/**
 * Back to the exact place a workspace link came from (SH1), above every firm page opened with
 * `?from=`. A form with unsaved work asks first. Arriving back, the page scrolls to where it was.
 */
export function OriginBar() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const from = safeOrigin(params.get(ORIGIN_PARAM));
  const search = params.toString();

  useEffect(() => {
    const y = takeScroll(`${pathname}${search ? `?${search}` : ''}`);
    if (y !== null) restoreScroll(y);
  }, [pathname, search]);

  if (!from) return null;
  const leave = () => {
    setAsking(false);
    markReturn(from);
    router.push(from);
  };
  const label = originLabel(from);
  return (
    <div className="mb-3">
      <button
        type="button"
        data-testid="back-to-origin"
        onClick={() => (hasUnsavedChanges() ? setAsking(true) : leave())}
        className="inline-flex min-h-9 w-fit items-center gap-2 text-sm font-semibold text-link hover:underline"
      >
        <ArrowLeft aria-hidden weight="bold" className="size-4" />
        Back to {label}
      </button>
      <Modal
        open={asking}
        title="Leave without saving?"
        subtitle="Your changes on this page are not saved yet."
        onClose={() => setAsking(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAsking(false)}>
              Stay on This Page
            </Button>
            <Button onClick={leave}>Leave Without Saving</Button>
          </>
        }
      >
        <p className="text-sm text-text">
          Back to {label} closes this page. Anything you entered here is lost.
        </p>
      </Modal>
    </div>
  );
}
