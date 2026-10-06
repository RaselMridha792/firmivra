import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Payroll' };

export default function PayrollPage() {
  return (
    <PagePlaceholder
      title="Payroll"
      ticket="N07b"
      owner="Ibrahim"
      mockup="begin-online/Payroll*.png (3 files)"
    />
  );
}
