import type { Metadata } from 'next';
import { FinancialAnalysis } from '../_components/financials-screen';

export const metadata: Metadata = { title: 'Business advisory: Financial analysis' };

export default function BusinessAdvisoryFinancialAnalysisPage() {
  return <FinancialAnalysis />;
}
