import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'My Uploaded Documents' };

export default function MyUploadedDocumentsPage() {
  return (
    <PagePlaceholder
      title="My Uploaded Documents"
      ticket="N05"
      owner="Nahid"
      mockup="client-portal/My docs tab.png, Upload docs popup.png"
    />
  );
}
