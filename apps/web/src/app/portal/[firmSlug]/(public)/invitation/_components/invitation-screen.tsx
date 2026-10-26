'use client';

import { ApiRequestError, type OpenedPortalInvitation } from '@firmivra/types';
import { Skeleton } from '@firmivra/ui';
import { BadgeCheck, MailCheck, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorCode, errorMessage } from '../../../../../../lib/errors';
import { usePortal } from '../../../layout';
import { ButtonLink } from '../../_components/button-link';
import { FirmContactLinks } from '../../_components/firm-contact';
import { type Benefit, SignUpFrame, StepHeading } from '../../sign-up/_components/sign-up-frame';

const BENEFITS: Benefit[] = [
  [
    MailCheck,
    'Use the invited email',
    'Create your account with the address this invitation went to.',
  ],
  [
    ShieldCheck,
    'A private link',
    'It works for 7 days and only for you; a new invitation replaces it.',
  ],
  [BadgeCheck, 'The firm approves', 'Your firm checks the new account before the portal opens.'],
];

type State =
  | { kind: 'loading' }
  | { kind: 'open'; invitation: OpenedPortalInvitation }
  | { kind: 'invalid' }
  | { kind: 'signed-up' }
  | { kind: 'error'; message: string };

const dayText = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

/**
 * /{firm}/invitation#token=... (Business Advisory B3): the link in the firm's portal invitation.
 * The token stays in the fragment (never sent with the page) and is traded once for what the
 * invitation says; the account itself is made on the sign-up pages and approved by the firm.
 */
export function InvitationScreen() {
  const { business } = usePortal();
  const slug = business.slug;
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    let live = true;
    // A link without a token opens nothing: the same answer as an ended one.
    (token
      ? api.portalInvitation(slug).open({ token })
      : Promise.reject(new ApiRequestError(410, 'INVITATION_INVALID', 'No invitation token'))
    )
      .then((invitation) => live && setState({ kind: 'open', invitation }))
      .catch((error: unknown) => {
        if (!live) return;
        const code = errorCode(error);
        if (code === 'ALREADY_SIGNED_UP') setState({ kind: 'signed-up' });
        else if (code === 'INVITATION_INVALID' || code === 'VALIDATION_FAILED') {
          setState({ kind: 'invalid' });
        } else setState({ kind: 'error', message: errorMessage(error) });
      });
    return () => {
      live = false;
    };
  }, [slug]);

  return (
    <SignUpFrame
      heading="You're"
      highlight="Invited"
      intro={`${business.name} invites you to its secure client portal to share documents, sign forms and message the firm.`}
      benefits={BENEFITS}
    >
      <div data-testid="portal-invitation" className="grid gap-5">
        {state.kind === 'loading' ? (
          <>
            <StepHeading title="Accept Your Invitation">Checking your invitation link…</StepHeading>
            <Skeleton className="h-24 w-full" />
          </>
        ) : state.kind === 'open' ? (
          <>
            <StepHeading title="Accept Your Invitation">
              {state.invitation.firmName} invited {state.invitation.name} to its client portal.
            </StepHeading>
            <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-card border border-border bg-surface p-4 text-base">
              <dt className="font-semibold text-heading">Invited</dt>
              <dd className="text-text">{state.invitation.name}</dd>
              <dt className="font-semibold text-heading">Sign up with</dt>
              <dd className="break-all text-text">{state.invitation.maskedEmail}</dd>
              <dt className="font-semibold text-heading">Link works until</dt>
              <dd className="text-text">{dayText(state.invitation.expiresAt)}</dd>
            </dl>
            <p className="text-text">
              Create your account with the invited email address. {state.invitation.firmName}{' '}
              approves it, and then you can sign in.
            </p>
            <ButtonLink href={`/${slug}/sign-up`}>Create My Account</ButtonLink>
            <p className="text-center text-text">
              Already have an account?{' '}
              <Link className="text-link underline" href={`/${slug}/sign-in`}>
                Sign in
              </Link>
            </p>
          </>
        ) : state.kind === 'signed-up' ? (
          <>
            <StepHeading title="You Already Have an Account">
              An account with the invited email exists. Sign in to continue, or wait for the firm to
              approve it.
            </StepHeading>
            <ButtonLink href={`/${slug}/sign-in`}>Sign In</ButtonLink>
          </>
        ) : (
          <>
            <StepHeading title="This Invitation Link Has Ended">
              {state.kind === 'error'
                ? state.message
                : 'It has expired, or the firm sent a newer one or withdrew it. Ask the firm for a new invitation.'}
            </StepHeading>
            <div className="rounded-card border border-border bg-surface p-4">
              <p className="mb-2 font-semibold text-heading">Contact {business.name}</p>
              <FirmContactLinks />
            </div>
            <ButtonLink variant="outline" href={`/${slug}/sign-in`}>
              Go to Sign In
            </ButtonLink>
          </>
        )}
      </div>
    </SignUpFrame>
  );
}
