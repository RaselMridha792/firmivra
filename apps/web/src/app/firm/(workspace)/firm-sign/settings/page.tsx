import type { Metadata } from 'next';
import { SigningSettings } from './_components/signing-settings';

export const metadata: Metadata = { title: 'Signing settings' };

export default function SigningSettingsPage() {
  return <SigningSettings />;
}
