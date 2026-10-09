import type { Metadata } from 'next';
import { ResourcePage } from '../_components/resource-page';

export const metadata: Metadata = { title: 'Payroll Resources' };

export default function Page() {
  return (
    <ResourcePage
      page="payroll"
      heading="Payroll"
      highlight="Resources"
      intro="What every employer needs to know to pay people correctly and on time."
    />
  );
}
