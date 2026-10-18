import type { Metadata } from 'next';
import { SalesCenter } from './_components/sales-center';

export const metadata: Metadata = { title: 'Sales' };

export default function AdminSalesPage() {
  return <SalesCenter />;
}
