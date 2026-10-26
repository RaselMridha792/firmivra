import type { Metadata } from 'next';
import { InvitationScreen } from './_components/invitation-screen';

export const metadata: Metadata = { title: 'Your invitation' };

export default function InvitationPage() {
  return <InvitationScreen />;
}
