'use client';

import { Check } from 'lucide-react';
import Link from 'next/link';
import { PageState } from '../../../../../../components/page-state';
import { portalAuth } from '../../../../../../lib/auth';
import { errorCode } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';
import { usePortal } from '../../../layout';
import { ButtonLink } from '../../_components/button-link';
import { StepHeading } from './sign-up-frame';
import { useSignUpState } from './use-sign-up-state';
import { ContactFirm, Expired } from './verify-step';

const PORTAL_BUTTON_CLASSES =
  'bg-platform-blue! hover:bg-platform-blue-hover! focus-visible:outline-platform-blue';

/**
 * Complete (docs/mockups/client-portal/LVP Client Portal Account Confirmation.png). Also where
 * the shell sends a signed-in client the firm has not approved yet: with no sign-up in progress,
 * GET .../me says whether this person is waiting for approval.
 */
export function DoneStep() {
  const { business } = usePortal();
  const { state } = useSignUpState(business.slug);
  if (errorCode(state.error) === 'SIGN_UP_EXPIRED') return <Waiting />;
  return (
    <PageState query={state}>
      {(s) =>
        s.step === 'DONE' ? <Created /> : s.step === 'CONTACT_FIRM' ? <ContactFirm /> : <Waiting />
      }
    </PageState>
  );
}

function Created({ waiting = false }: { waiting?: boolean }) {
  const { business } = usePortal();
  return (
    <div
      data-testid="sign-up-done"
      className="grid gap-4 text-center [&_header]:mb-0 [&_header_p]:text-firm-text [&_h1]:text-platform-navy md:[&_header_p]:text-xl md:[&_h1]:text-5xl"
    >
      <Check
        aria-hidden
        strokeWidth={3}
        className="mx-auto size-24 rounded-full bg-folder-surface p-6 text-platform-blue"
      />
      <StepHeading title="Account Created!">
        {waiting
          ? 'Your account is waiting for approval.'
          : 'Your email and phone number have been verified.'}
      </StepHeading>
      <p className="text-lg text-firm-text">
        {business.name} reviews every new account. We&apos;ll email you when your client portal is
        ready.
      </p>
      <ButtonLink className={PORTAL_BUTTON_CLASSES} href={`/${business.slug}/sign-in`}>
        Go to Client Portal
      </ButtonLink>
      <div aria-hidden className="flex items-center gap-6 px-12 text-sm text-muted">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      <Link className="text-platform-blue underline" href={`/${business.slug}`}>
        Return to Homepage
      </Link>
    </div>
  );
}

/** No finished sign-up here: a signed-in client waiting for approval, or nothing to show. */
function Waiting() {
  const { business } = usePortal();
  const me = useApiQuery(['portal-me', business.slug], () => portalAuth(business.slug).me());
  if (me.isPending) return <PageState query={me}>{() => null}</PageState>;
  const status = me.data?.clientAccounts[0]?.status;
  if (status === 'PENDING_APPROVAL') return <Created waiting />;
  if (status === 'ACTIVE') {
    return (
      <div role="status" className="grid gap-4 text-center">
        <StepHeading title="Your account is ready" />
        <ButtonLink className={PORTAL_BUTTON_CLASSES} href={`/${business.slug}/home`}>
          Go to Client Portal
        </ButtonLink>
      </div>
    );
  }
  return <Expired />;
}
