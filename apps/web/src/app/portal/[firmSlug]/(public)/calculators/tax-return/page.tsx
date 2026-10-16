import type { Metadata } from 'next';
import { PageContainer } from '@firmivra/ui';
import { TaxReturnScreen } from '../../../(client)/calculator/_components/tax-return-screen';

export const metadata: Metadata = { title: 'Tax Return Estimator' };

export default function PublicTaxReturnPage() {
  return (
    <PageContainer width="public" className="py-8">
      <TaxReturnScreen publicPage />
    </PageContainer>
  );
}
