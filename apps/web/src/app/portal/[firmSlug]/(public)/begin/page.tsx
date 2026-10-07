import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Begin online' };

export default function BeginOnlinePage() {
  return (
    <PagePlaceholder
      title="Begin online"
      ticket="N07a"
      owner="Arfan"
      mockup="begin-online/Begin online.png"
    />
  );
}
