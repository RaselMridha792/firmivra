import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Business development' };

export default function BusinessDevelopmentPage() {
  return (
    <PagePlaceholder
      title="Business development"
      ticket="N07b"
      owner="Ibrahim"
      mockup="begin-online/Development intake*.png (4 files)"
    />
  );
}
