import type { Metadata } from 'next';
import { BrandingSettings } from './_components/branding-settings';

export const metadata: Metadata = { title: 'Branding & appearance' };

export default function BrandingSettingsPage() {
  return <BrandingSettings />;
}
