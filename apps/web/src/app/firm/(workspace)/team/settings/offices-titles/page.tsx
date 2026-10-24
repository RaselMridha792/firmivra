import type { Metadata } from 'next';
import { OfficesTitlesScreen } from './_components/offices-titles-screen';

export const metadata: Metadata = { title: 'Offices & job titles' };

export default function OfficesTitlesPage() {
  return <OfficesTitlesScreen />;
}
