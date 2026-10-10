import type { Metadata } from 'next';
import { SignInScreen } from './_components/sign-in-screen';

export const metadata: Metadata = { title: 'Sign in' };

export default function SignInPage() {
  return <SignInScreen />;
}
