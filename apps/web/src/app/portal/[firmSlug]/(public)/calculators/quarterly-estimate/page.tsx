import type { Metadata } from 'next';
import { PageContainer } from '@firmivra/ui';
import { QuarterlyScreen } from '../../../(client)/calculator/_components/quarterly-screen';

export const metadata: Metadata = { title: 'Quarterly Estimated Tax Calculator' };

export default function PublicQuarterlyEstimatePage() {
  return (
    <PageContainer width="public" className="py-8">
      <QuarterlyScreen publicPage />
    </PageContainer>
  );
}
