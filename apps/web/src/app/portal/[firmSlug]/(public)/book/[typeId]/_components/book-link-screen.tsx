'use client';

import { ApiRequestError, type PublicBookingType } from '@firmivra/types';
import { Skeleton } from '@firmivra/ui';
import { CalendarCheck, Clock, LockKeyhole } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { api } from '../../../../../../../lib/api';
import { portalAuth } from '../../../../../../../lib/auth';
import { bookingPath, keepBooking } from '../../../../../../../lib/booking-intent';
import { errorCode } from '../../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../../lib/query';
import { refreshSession } from '../../../../../../../lib/session';
import { LOCATION_LABELS } from '../../../../(client)/appointments/_components/shared';
import { usePortal } from '../../../../layout';
import { ButtonLink } from '../../../_components/button-link';
import { FirmContactLinks } from '../../../_components/firm-contact';
import { type Benefit, SignUpFrame, StepHeading } from '../../../sign-up/_components/sign-up-frame';

const BENEFITS: Benefit[] = [
  [CalendarCheck, 'This appointment', 'The link opens booking on the appointment you chose.'],
  [Clock, 'Pick a free time', 'See the free times and book in a few clicks.'],
  [LockKeyhole, 'Your secure portal', 'You book inside your client portal, after signing in.'],
];

/** The signed-in client's session at this firm, refreshed once as the portal's pages do. */
async function sessionAt(slug: string) {
  const auth = portalAuth(slug);
  try {
    return await auth.me();
  } catch (e) {
    const unauthorized = e instanceof ApiRequestError && e.status === 401;
    if (!unauthorized || !(await refreshSession(() => auth.refresh()))) throw e;
    return auth.me();
  }
}

/**
 * /{firm}/book/{typeId} (Appointments Review 2, row 3): an appointment type's booking link. The
 * type is read without signing in; an archived type, one clients can't book online, or none at
 * all is refused here with a way to contact the firm. Otherwise the type is kept in this browser
 * (lib/booking-intent.ts): a signed-in client goes straight to booking on it, and anyone else
 * signs in or creates an account and lands on it at their next sign-in. A client the firm has not
 * approved yet is told they can book once it does.
 */
export function BookLinkScreen({ typeId }: { typeId: string }) {
  const { business } = usePortal();
  const slug = business.slug;
  const router = useRouter();
  const type = useApiQuery(['public-booking', slug, typeId], () =>
    api.publicBooking(slug).type(typeId),
  );
  const live = type.data?.state === 'LIVE';
  const me = useApiQuery(['portal-me', slug, 'booking-link'], () => sessionAt(slug));
  const status = me.data?.clientAccounts[0]?.status;

  useEffect(() => {
    if (!live) return;
    keepBooking(slug, typeId);
    if (status === 'ACTIVE') router.replace(bookingPath(slug, typeId));
  }, [live, status, slug, typeId, router]);

  return (
    <SignUpFrame
      heading="Book an"
      highlight="Appointment"
      intro={`Book a time with ${business.name} in your secure client portal.`}
      benefits={BENEFITS}
    >
      <div data-testid="booking-link" className="grid gap-5">
        {type.isPending || (live && (me.isPending || status === 'ACTIVE')) ? (
          <>
            <StepHeading title="Book an Appointment">
              {status === 'ACTIVE' ? 'Opening booking…' : 'Checking your booking link…'}
            </StepHeading>
            <Skeleton className="h-24 w-full" />
          </>
        ) : type.data && live ? (
          <Bookable type={type.data} waiting={status === 'PENDING_APPROVAL'} />
        ) : (
          <Refused type={type.data} failed={type.isError && !isGone(type.error)} />
        )}
      </div>
    </SignUpFrame>
  );
}

/** No such type at this firm (or an id that can't be one): the link does not work. */
const isGone = (error: unknown) => {
  const code = errorCode(error);
  return code === 'NOT_FOUND' || code === 'VALIDATION_FAILED';
};

function Facts({ type }: { type: PublicBookingType }) {
  return (
    <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-card border border-border bg-surface p-4 text-base">
      <dt className="font-semibold text-heading">Appointment</dt>
      <dd data-testid="booking-link-type" className="text-text">
        {type.name}
      </dd>
      <dt className="font-semibold text-heading">Length</dt>
      <dd className="text-text">{type.durationMinutes} minutes</dd>
      <dt className="font-semibold text-heading">Meets by</dt>
      <dd className="text-text">{type.methods.map((m) => LOCATION_LABELS[m]).join(', ')}</dd>
    </dl>
  );
}

/** A type that takes bookings, for a visitor who is not signed in, or not approved yet. */
function Bookable({ type, waiting }: { type: PublicBookingType; waiting: boolean }) {
  const { business, signUpOpen } = usePortal();
  const slug = business.slug;
  if (waiting) {
    return (
      <>
        <StepHeading title={`Book ${type.name}`}>
          Your account is waiting for {business.name} to approve it.
        </StepHeading>
        <Facts type={type} />
        <p data-testid="booking-after-approval" className="font-semibold text-heading">
          After the firm approves your account you can book this time.
        </p>
        <p className="text-text">
          We kept {type.name} for you: sign in once you hear from {business.name}, and booking opens
          on it.
        </p>
        <ButtonLink variant="outline" href={`/${slug}`}>
          Return to Homepage
        </ButtonLink>
      </>
    );
  }
  return (
    <>
      <StepHeading title={`Book ${type.name}`}>
        Sign in to your {business.name} client portal to choose a time.
      </StepHeading>
      <Facts type={type} />
      <ButtonLink href={`/${slug}/sign-in?book=${encodeURIComponent(type.id)}`}>
        Sign In to Book
      </ButtonLink>
      {signUpOpen ? (
        <p data-testid="booking-link-sign-up" className="text-center text-text">
          New to {business.name}?{' '}
          <Link className="text-link underline" href={`/${slug}/sign-up`}>
            Create an account
          </Link>
          . When {business.name} reviews new accounts first: after the firm approves your account
          you can book this time, and booking opens on {type.name} when you sign in.
        </p>
      ) : null}
    </>
  );
}

/** Archived, not bookable online, or no such type: refused, with the firm's contact. */
function Refused({ type, failed }: { type: PublicBookingType | undefined; failed: boolean }) {
  const { business } = usePortal();
  const [title, text] = failed
    ? [
        'This Page Did Not Load',
        'Something went wrong. Try again in a moment, or contact the firm.',
      ]
    : type?.state === 'ARCHIVED'
      ? [
          `${type.name} Is No Longer Offered`,
          `${business.name} no longer takes bookings for this appointment. Contact the firm to book another time.`,
        ]
      : type?.state === 'HIDDEN'
        ? [
            `${type.name} Can't Be Booked Online`,
            `${business.name} books this appointment itself. Contact the firm to arrange a time.`,
          ]
        : [
            'This Booking Link Does Not Work',
            `It is not one of ${business.name}'s appointments. Check the link, or contact the firm.`,
          ];
  return (
    <>
      <div role="alert" data-testid="booking-link-refused">
        <StepHeading title={title}>{text}</StepHeading>
      </div>
      <div className="rounded-card border border-border bg-surface p-4">
        <p className="mb-2 font-semibold text-heading">Contact {business.name}</p>
        <FirmContactLinks />
      </div>
      <ButtonLink variant="outline" href={`/${business.slug}`}>
        Return to Homepage
      </ButtonLink>
    </>
  );
}
