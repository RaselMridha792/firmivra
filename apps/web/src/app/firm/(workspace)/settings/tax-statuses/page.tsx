import type { Metadata } from 'next';
import { TaxStatusesScreen } from './_components/tax-statuses-screen';

// The reference screen (docs/junior/GUIDE.md): copy this folder's structure for your page.
// page.tsx stays a small server file with the title; the screen is a client component in
// _components/ (Next.js ignores folders that start with "_").
export const metadata: Metadata = { title: 'Tax statuses' };

export default function TaxStatusesPage() {
  return <TaxStatusesScreen />;
}
