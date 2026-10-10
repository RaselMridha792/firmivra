import type { Metadata } from 'next';
import { ResetPasswordScreen } from './_components/reset-password-screen';

export const metadata: Metadata = { title: 'Reset password' };

export default function ResetPasswordPage() {
  return <ResetPasswordScreen />;
}
