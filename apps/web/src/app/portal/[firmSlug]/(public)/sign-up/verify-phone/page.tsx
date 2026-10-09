import type { Metadata } from 'next';
import { VerifyPhoneScreen } from '../_components/step-screens';

export const metadata: Metadata = { title: 'Verify your phone' };

export default function Page() {
  return <VerifyPhoneScreen />;
}
