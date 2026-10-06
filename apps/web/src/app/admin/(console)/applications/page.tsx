import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Firm Applications' };

export default function Applications() {
  return (
    <PagePlaceholder
      title="Firm Applications"
      ticket="F04b"
      owner="Tumit"
      mockup="super-admin/Firm application.png"
    />
  );
}
