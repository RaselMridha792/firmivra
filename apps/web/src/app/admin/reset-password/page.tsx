import type { Metadata } from 'next';
import { PasswordRecovery } from '../../../components/auth/password-recovery';

export const metadata: Metadata = { title: 'Reset password' };

export default function Page() {
  return <PasswordRecovery site="admin" reset />;
}
