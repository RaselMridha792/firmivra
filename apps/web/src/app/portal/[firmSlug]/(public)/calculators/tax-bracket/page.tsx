import type { Metadata } from 'next';
import { PageContainer } from '@firmivra/ui';
import { TaxBracketScreen } from '../../../(client)/calculator/_components/tax-bracket-screen';

export const metadata: Metadata = { title: 'Tax Bracket Calculator' };

export default function PublicTaxBracketPage() {
  return (
    <PageContainer width="public" className="py-8">
      <TaxBracketScreen publicPage />
    </PageContainer>
  );
}
