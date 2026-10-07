import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Verify your phone' };

export default function VerifyYourPhonePage() {
  return (
    <PagePlaceholder
      title="Verify your phone"
      ticket="N02"
      owner="Nahid"
      mockup="client-portal/Verify phone.png"
    />
  );
}
