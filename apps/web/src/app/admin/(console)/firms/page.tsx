import type { Metadata } from 'next';
import { FirmsList } from './_components/firms-list';

export const metadata: Metadata = { title: 'Firms' };

export default function FirmsPage() {
  return <FirmsList />;
}
