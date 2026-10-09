import type { Metadata } from 'next';
import { SignUpsScreen } from './_components/sign-ups-screen';

export const metadata: Metadata = { title: 'Sign-ups' };

export default function SignUpsPage() {
  return <SignUpsScreen />;
}
