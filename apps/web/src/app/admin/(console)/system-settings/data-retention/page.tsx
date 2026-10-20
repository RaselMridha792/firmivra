import type { Metadata } from 'next';
import { DataRetention } from './_components/data-retention';

export const metadata: Metadata = { title: 'Data & retention' };

export default function DataRetentionPage() {
  return <DataRetention />;
}
