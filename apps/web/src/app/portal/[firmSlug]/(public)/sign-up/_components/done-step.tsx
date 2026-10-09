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
    <div data-testid="sign-up-done" className="grid gap-4 text-center">
      <Check
        aria-hidden
        className="mx-auto size-20 rounded-full bg-folder-surface p-4 text-firm-primary"
      />
      <StepHeading title="Account Created!">
        {waiting
          ? 'Your account is waiting for approval.'
          : 'Your email and phone number have been verified.'}
      </StepHeading>
      <p className="text-lg text-text">
        {business.name} reviews every new account. We&apos;ll email you when your client portal is
        ready.
      </p>
      <ButtonLink href={`/${business.slug}/sign-in`}>Go to Client Portal</ButtonLink>
      <Link className="text-link underline" href={`/${business.slug}`}>
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
        <ButtonLink href={`/${business.slug}/home`}>Go to Client Portal</ButtonLink>
      </div>
    );
  }
  return <Expired />;
}
