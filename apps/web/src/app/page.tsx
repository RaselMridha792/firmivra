import type { Metadata } from 'next';
import Image from 'next/image';
import { ComingSoon } from '@firmivra/ui';
import logo from '../../../../docs/mockups/Firmivra Abstract F Logo.png';

export const metadata: Metadata = {
  title: 'Firmivra | Coming Soon',
  description:
    'One workspace for business teams and client work, with a branded client portal. Firmivra is coming soon.',
};

export default function HomePage() {
  return (
    <ComingSoon
      brand="Firmivra"
      logo={<Image src={logo} alt="Firmivra" className="fv-logo-image" sizes="296px" preload />}
      description="Firmivra brings teams, client documents, messages, invoices and appointments into one workspace, with a branded portal for every business."
      launchAt="2027-01-08T00:00:00Z"
      launchDate="January 8, 2027 (UTC)"
    />
  );
}
