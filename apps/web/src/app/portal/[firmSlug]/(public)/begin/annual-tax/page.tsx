import type { Metadata } from 'next';
import { PagePlaceholder } from '../../../../../../components/page-placeholder';

export const metadata: Metadata = { title: 'Annual tax preparation' };

export default function AnnualTaxPreparationPage() {
  return (
    <PagePlaceholder
      title="Annual tax preparation"
      ticket="N07a"
      owner="Arfan"
      mockup="begin-online/Annual Intake Form 1.png to Annual Tax Intake Form 4.png"
    />
  );
}
