import type { Metadata } from 'next';
import { ResourcePage } from '../_components/resource-page';

export const metadata: Metadata = { title: 'Tax Deductions for Small Businesses' };

export default function Page() {
  return (
    <ResourcePage
      page="tax-deductions"
      heading="Tax Deductions for"
      highlight="Small Businesses"
      intro="Common deductions that can lower your business taxes, and the records to keep for each."
    />
  );
}
