import type { Metadata } from 'next';
import { SetupWizard } from './_components/setup-wizard';

export const metadata: Metadata = { title: 'Set up your firm' };

export default function SetUpYourFirmPage() {
  return <SetupWizard />;
}
