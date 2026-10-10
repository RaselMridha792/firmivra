'use client';

import { FileText, Folder, MessageSquareMore, ShieldCheck } from 'lucide-react';
import { type Benefit, SignUpFrame, StepHeading } from './sign-up-frame';
import { SignUpForm } from './sign-up-form';

const benefits: Benefit[] = [
  [FileText, 'Upload & share documents', 'Send tax documents and files securely.'],
  [MessageSquareMore, 'Message our team', 'Get answers to your questions quickly.'],
  [Folder, 'View your records', 'Access your tax returns and important documents anytime.'],
  [
    ShieldCheck,
    'Your information is safe',
    'We use industry-standard security to protect your data.',
  ],
];

/** /{firm}/sign-up from docs/mockups/client-portal/LVP Client Portal Sign-Up Page.png (N02). */
export function SignUpScreen() {
  return (
    <SignUpFrame
      step="create"
      heading="Sign Up to Access Your"
      highlight="Client Portal"
      intro="Create your secure account in just a few minutes to access your documents, communicate with our team, and stay on top of your financial information, all in one place."
      benefits={benefits}
    >
      <StepHeading title="Create Your Account">
        Enter your information below to get started.
      </StepHeading>
      <SignUpForm />
    </SignUpFrame>
  );
}
