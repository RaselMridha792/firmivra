'use client';

import { ApiRequestError, type BusinessSummary } from '@firmivra/types';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { claimCache } from '../../lib/session';
import { FirmContext } from '../firm-context';
import { SignedIn, useMe } from '../signed-in';

/**
 * The in-person kiosk frame: the same sign-in and firm checks as the workspace layout (an inactive
 * firm, one in setup or a lost session never reaches the page), without the sidebar or menu.
 * While an in-person signing is open the API locks the staff session and GET /business answers
 * 403 KIOSK_LOCKED: the kiosk pages still open then, without the firm (they never need it).
 */
export function KioskFrame({ children }: { children: ReactNode }) {
  return (
    <SignedIn site="firm" signInPath="/sign-in">
      <KioskFirm>{children}</KioskFirm>
    </SignedIn>
  );
}

function KioskFirm({ children }: { children: ReactNode }) {
  const { me } = useMe();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [firm, setFirm] = useState<BusinessSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    let active = true;
    api.currentBusiness().then(
      (b) => {
        if (!active) return;
        // Another firm than last time on this tab starts with an empty data cache.
        claimCache(queryClient, 'firm', b.id);
        setFirm(b);
      },
      (e: unknown) => {
        if (!active) return;
        const code = e instanceof ApiRequestError ? e.code : 'ERROR';
        if (code === 'BUSINESS_SETUP_REQUIRED') router.replace('/setup');
        else if (e instanceof ApiRequestError && e.status === 401) router.replace('/sign-in');
        else if (code === 'KIOSK_LOCKED') setLocked(true);
        else setError(code);
      },
    );
    return () => {
      active = false;
    };
  }, [router, queryClient]);

  if (locked) return <main className="min-h-screen bg-canvas p-6 text-text">{children}</main>;

  if (error) {
    return (
      <p data-testid="firm-error" className="p-6 font-medium text-text">
        We couldn&apos;t open your firm. ({error})
      </p>
    );
  }
  if (!firm) {
    return (
      <div aria-busy="true" className="flex min-h-screen items-center justify-center text-muted">
        Loading…
      </div>
    );
  }
  const role = me.memberships.find((m) => m.business.id === firm.id && m.status === 'ACTIVE')?.role;
  return (
    <main className="min-h-screen bg-canvas p-6 text-text">
      <FirmContext value={{ firm, role }}>{children}</FirmContext>
    </main>
  );
}
