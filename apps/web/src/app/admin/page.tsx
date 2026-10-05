import type { Metadata } from 'next';
import { SessionPanel } from '../../components/session-panel';

export const metadata: Metadata = { title: 'Firmivra Super Admin' };

export default function AdminHome() {
  return (
    <SessionPanel
      title="Super Admin console"
      signInPath="/sign-in"
      firm={{ kind: 'none' }}
      site="admin"
    />
  );
}
