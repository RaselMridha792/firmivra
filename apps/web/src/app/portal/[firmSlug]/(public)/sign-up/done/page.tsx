import type { Metadata } from 'next';
import { DoneScreen } from '../_components/step-screens';

export const metadata: Metadata = { title: 'Account created' };

export default function Page() {
  return <DoneScreen />;
}
