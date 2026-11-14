import type { ReactNode } from 'react';
import { ClientShell } from '../_components/manage/client-shell';

/** /client-portal/{clientId}/...: one client's portal management (Frame 2). */
export default async function ClientPortalClientLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  return <ClientShell clientId={clientId}>{children}</ClientShell>;
}
