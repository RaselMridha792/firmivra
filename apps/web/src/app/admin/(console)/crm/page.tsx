import type { Metadata } from 'next';
import { PlatformCrm } from './_components/platform-crm';

export const metadata: Metadata = { title: 'Platform CRM' };

export default function PlatformCrmPage() {
  return <PlatformCrm />;
}
