import type { Metadata } from 'next';
import { ForgotPasswordScreen } from './_components/forgot-password-screen';

export const metadata: Metadata = { title: 'Forgot password' };

export default function ForgotPasswordPage() {
  return <ForgotPasswordScreen />;
}
