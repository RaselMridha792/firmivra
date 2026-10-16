import type { Metadata } from 'next';
import { RecordKeepingScreen } from './_components/record-keeping-screen';

export const metadata: Metadata = { title: 'Record Keeping Best Practices' };

export default function Page() {
  return <RecordKeepingScreen />;
}
