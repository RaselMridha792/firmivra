import type { Metadata } from 'next';
import { LandingScreen } from './_components/landing-screen';

export const metadata: Metadata = { title: 'Client portal' };

export default function ClientPortalPage() {
  return <LandingScreen />;
}
