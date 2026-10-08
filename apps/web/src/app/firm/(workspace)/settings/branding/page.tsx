import type { Metadata } from 'next';
import { BrandingSettings } from './_components/branding-settings';

export const metadata: Metadata = { title: 'Branding' };

export default function BrandingPage() {
  return <BrandingSettings />;
}
