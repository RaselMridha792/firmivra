import type { Metadata } from 'next';
import { SessionPanel } from '../../components/session-panel';

export const metadata: Metadata = { title: 'Firmivra workspace' };

export default function FirmHome() {
  return <SessionPanel title="Firm workspace" signInPath="/sign-in" firm={{ kind: 'staff' }} />;
}
