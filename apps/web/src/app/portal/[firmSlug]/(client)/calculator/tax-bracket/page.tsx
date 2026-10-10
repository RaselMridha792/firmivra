import type { Metadata } from 'next';
import { TaxBracketScreen } from '../_components/tax-bracket-screen';

export const metadata: Metadata = { title: 'Tax Bracket Calculator' };

export default function TaxBracketPage() {
  return <TaxBracketScreen />;
}
