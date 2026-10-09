import type { Metadata } from 'next';
import { SignUpScreen } from './_components/sign-up-screen';

export const metadata: Metadata = { title: 'Sign up' };

export default function SignUpPage() {
  return <SignUpScreen />;
}
