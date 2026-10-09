'use client';

import { FileText, Folder, MessageSquareMore, ShieldCheck } from 'lucide-react';
import { DoneStep } from './done-step';
import { type Benefit, SignUpFrame } from './sign-up-frame';
import { VerifyStep } from './verify-step';

const verifyBenefits: Benefit[] = [
  [ShieldCheck, 'Secure Access', 'Keep your information safe and secure.'],
  [MessageSquareMore, 'Easy Communication', 'Message our team anytime.'],
  [Folder, 'All in One Place', 'Access your documents and tax records.'],
];

const doneBenefits: Benefit[] = [
  [FileText, 'Upload Documents', 'Send tax documents and files securely.'],
  [MessageSquareMore, 'Message Our Team', 'Get answers to your questions quickly.'],
  [Folder, 'View Your Records', 'Access your tax returns and important documents anytime.'],
  [
    ShieldCheck,
    'Your Information is Safe',
    'We use industry-standard security to protect your data.',
  ],
];

/** /{firm}/sign-up/verify-email from docs/mockups/client-portal/Verify email .png (N02). */
export function VerifyEmailScreen() {
  return (
    <SignUpFrame
      step="email"
      heading="Verify Your"
      highlight="Email Address"
      intro="We've sent a 6-digit verification code to your email. Please enter the code below to confirm your email address and continue."
      benefits={verifyBenefits}
    >
      <VerifyStep channel="email" />
    </SignUpFrame>
  );
}

/** /{firm}/sign-up/verify-phone from docs/mockups/client-portal/Verify phone.png (N02). */
export function VerifyPhoneScreen() {
  return (
    <SignUpFrame
      step="phone"
      heading="Verify Your"
      highlight="Phone Number"
      intro="We've sent a 6-digit verification code by text to your phone. Please enter the code below to finish creating your account."
      benefits={verifyBenefits}
    >
      <VerifyStep channel="phone" />
    </SignUpFrame>
  );
}

/** /{firm}/sign-up/done from docs/mockups/client-portal/LVP Client Portal Account Confirmation.png. */
export function DoneScreen() {
  return (
    <SignUpFrame
      step="done"
      heading="You're"
      highlight="All Set!"
      intro="Your account has been created. Once the firm approves it, you can upload documents, view your records, and communicate with our team, all in one secure place."
      benefits={doneBenefits}
    >
      <DoneStep />
    </SignUpFrame>
  );
}
