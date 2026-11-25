import { Suspense, type ReactNode } from 'react';
import { ClosedFirmDownloadLink } from './closed-firm-download/closed-firm-download-link';

export default async function FirmDetailLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <Suspense fallback={null}>
        <ClosedFirmDownloadLink firmId={id} />
      </Suspense>
      {children}
    </>
  );
}
