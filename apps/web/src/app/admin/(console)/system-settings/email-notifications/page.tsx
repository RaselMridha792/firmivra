import type { Metadata } from 'next';
import { EmailSettings } from './_components/email-settings';

export const metadata: Metadata = { title: 'Email & notifications' };

export default function EmailSettingsPage() {
  return <EmailSettings />;
}
