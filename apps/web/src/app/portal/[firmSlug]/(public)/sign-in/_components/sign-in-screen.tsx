'use client';

import { FileText, Folder, MessageSquareMore, ShieldCheck } from 'lucide-react';
import { usePortal } from '../../../layout';
import { type Benefit, SignUpFrame, StepHeading } from '../../sign-up/_components/sign-up-frame';
import { SignInForm } from './sign-in-form';

const benefits: Benefit[] = [
  [FileText, 'Your documents', 'Upload and download your tax documents securely.'],
  [MessageSquareMore, 'Message our team', 'Get answers to your questions quickly.'],
  [Folder, 'View your records', 'Access your tax returns and invoices anytime.'],
  [ShieldCheck, 'Your information is safe', 'We use industry-standard security.'],
];

/** /{firm}/sign-in in the sign-up pages' style (no mockup; N03). */
export function SignInScreen() {
  const { business } = usePortal();
  return (
    <SignUpFrame
      heading="Welcome Back to Your"
      highlight="Client Portal"
      intro="Sign in to access your documents, forms, invoices, and messages, all in one secure place."
      benefits={benefits}
    >
      <h1 className="sr-only">Client portal: {business.slug}</h1>
      <StepHeading title="Sign In" level={2}>
        Enter your email and password.
      </StepHeading>
      <SignInForm />
    </SignUpFrame>
  );
}
