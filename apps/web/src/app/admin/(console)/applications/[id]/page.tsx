import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Firm application' };

export default function Application() {
  return (
    <PagePlaceholder
      title="Firm application"
      ticket="F04b"
      owner="Tumit"
      mockup="super-admin/When firm aplication is open.png, Firm approved.png"
    />
  );
}
