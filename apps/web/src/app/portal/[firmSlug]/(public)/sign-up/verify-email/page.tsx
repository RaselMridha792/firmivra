import type { Metadata } from 'next';
import { VerifyEmailScreen } from '../_components/step-screens';

export const metadata: Metadata = { title: 'Verify your email' };

export default function Page() {
  return <VerifyEmailScreen />;
}
