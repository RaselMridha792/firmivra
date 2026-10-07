import type { Metadata } from 'next';
import { Settings } from '../../../features/settings';

export const metadata: Metadata = { title: 'Set up your firm' };

export default function SetUpYourFirmPage() {
  return <Settings wizard />;
}
