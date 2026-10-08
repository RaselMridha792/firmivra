'use client';

import { ApiRequestError, type PortalInfo } from '@firmivra/types';
import { notFound, useParams } from 'next/navigation';
import { createContext, use, type CSSProperties, type ReactNode } from 'react';
import { PageState } from '../../../components/page-state';
import { portalAuth } from '../../../lib/auth';
import { useApiQuery } from '../../../lib/query';

export const PortalContext = createContext<PortalInfo | null>(null);
export function usePortal() {
  const firm = use(PortalContext);
  if (!firm) throw new Error('Portal branding is unavailable');
  return firm;
}

/**
 * Every page of one firm's portal (/{firm}/...). The firm's colours are the tokens
 * --color-firm-primary and --color-firm-accent, with defaults in packages/ui. R3's public
 * GET /api/v1/portal/{slug}/info lets this layout load the firm and set those two colours
 * from it and shows not-found for an unknown slug. Nahid polishes it (N01).
 */
export default function FirmPortalLayout({ children }: { children: ReactNode }) {
  const { firmSlug } = useParams<{ firmSlug: string }>();
  const query = useApiQuery(['portal-info', firmSlug], () => portalAuth(firmSlug).info());
  if (query.error instanceof ApiRequestError && query.error.code === 'NOT_FOUND') notFound();
  const colors = {
    '--color-firm-primary': query.data?.branding.primaryColor,
    '--color-firm-accent': query.data?.branding.accentColor,
  } as CSSProperties;
  return (
    <div data-theme="portal" className="min-h-screen bg-canvas text-firm-primary" style={colors}>
      <PageState query={query}>
        {(firm) => <PortalContext value={firm}>{children}</PortalContext>}
      </PageState>
    </div>
  );
}
