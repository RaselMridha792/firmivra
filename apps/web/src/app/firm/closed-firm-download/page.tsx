import type { Metadata } from 'next';
import { OwnerDownload } from './owner-download';

export const metadata: Metadata = {
  title: 'Closed-firm download',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ClosedFirmDownloadPage() {
  return <OwnerDownload />;
}
