import type { Metadata } from 'next';
import { PageContainer } from '@firmivra/ui';
import { CalculatorsHub } from '../../(client)/calculator/_components/calculators-hub';

export const metadata: Metadata = { title: 'Calculators' };

export default function PublicCalculatorsPage() {
  return (
    <PageContainer width="public" className="py-8">
      <CalculatorsHub publicPage />
    </PageContainer>
  );
}
