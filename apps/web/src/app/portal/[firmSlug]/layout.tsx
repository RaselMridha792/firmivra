'use client';

import { ApiRequestError, type PortalInfo } from '@firmivra/types';
import { notFound, useParams, usePathname } from 'next/navigation';
import { createContext, use, type CSSProperties, type ReactNode } from 'react';
import { PageState } from '../../../components/page-state';
import { portalAuth } from '../../../lib/auth';
import { useApiQuery } from '../../../lib/query';
import { firmThemeVars } from '../../../lib/theme';
import { plainForm } from './plain-form';

export { plainForm };

export const PortalContext = createContext<PortalInfo | null>(null);
export function usePortal() {
  const firm = use(PortalContext);
  if (!firm) throw new Error('Portal branding is unavailable');
  return firm;
}

export default function FirmPortalLayout({ children }: { children: ReactNode }) {
  const { firmSlug } = useParams<{ firmSlug: string }>();
  const pathname = usePathname();
  const query = useApiQuery(['portal-info', firmSlug], () => portalAuth(firmSlug).info());
  if (query.error instanceof ApiRequestError && query.error.code === 'NOT_FOUND') notFound();
  // Intake Review 2 23-g: a form outside the portal with the firm's form branding off keeps the
  // platform's colours.
  const colors = (
    plainForm(pathname, firmSlug, query.data?.branding)
      ? {}
      : {
          '--color-firm-primary': query.data?.branding.primaryColor,
          '--color-firm-accent': query.data?.branding.accentColor,
          ...firmThemeVars(query.data?.branding),
        }
  ) as CSSProperties;
  return (
    <div data-theme="portal" className="min-h-screen bg-canvas text-firm-text" style={colors}>
      <PageState query={query}>
        {(firm) => <PortalContext value={firm}>{children}</PortalContext>}
      </PageState>
    </div>
  );
}
