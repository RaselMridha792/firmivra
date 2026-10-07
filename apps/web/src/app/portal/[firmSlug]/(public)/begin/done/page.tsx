import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Thank you' };

export default function ThankYouPage() {
  return (
    <PagePlaceholder
      title="Thank you"
      ticket="N07c"
      owner="Ibrahim"
      mockup="begin-online/Success Tax Prep.png, Success Page for all services except taxes.png"
    />
  );
}
