import type { Metadata } from 'next';
import { DefaultSettings } from './_components/default-settings';

export const metadata: Metadata = { title: 'Default user & firm settings' };

export default function DefaultSettingsPage() {
  return <DefaultSettings />;
}
