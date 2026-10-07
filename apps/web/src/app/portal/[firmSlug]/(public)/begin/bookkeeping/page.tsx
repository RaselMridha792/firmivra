import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Bookkeeping' };

export default function BookkeepingPage() {
  return (
    <PagePlaceholder
      title="Bookkeeping"
      ticket="N07b"
      owner="Ibrahim"
      mockup="begin-online/Bookkeeping*.png (4 files)"
    />
  );
}
