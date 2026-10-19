import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RecordPayment } from '../_components/record-payment';

export const metadata: Metadata = { title: 'Record Payment' };

export default function RecordPaymentPage() {
  return (
    <Suspense>
      <RecordPayment />
    </Suspense>
  );
}
