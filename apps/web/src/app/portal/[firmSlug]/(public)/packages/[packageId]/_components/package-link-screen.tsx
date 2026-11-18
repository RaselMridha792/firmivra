'use client';

import type { PublicPackage, PublicPackageDetails } from '@firmivra/types';
import { Skeleton } from '@firmivra/ui';
import { CheckCircle2, LockKeyhole, MessageSquare, Package, XCircle } from 'lucide-react';
import Link from 'next/link';
import { api } from '../../../../../../../lib/api';
import { errorCode } from '../../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../../lib/query';
import { usePortal } from '../../../../layout';
import { ButtonLink } from '../../../_components/button-link';
import { FirmContactLinks } from '../../../_components/firm-contact';
import { type Benefit, SignUpFrame, StepHeading } from '../../../sign-up/_components/sign-up-frame';

const BENEFITS: Benefit[] = [
  [Package, 'This package', 'See what it includes and what it costs.'],
  [MessageSquare, 'Ask the firm', 'Start in your portal, or contact the firm directly.'],
  [LockKeyhole, 'Your secure portal', 'Everything about your work stays in your client portal.'],
];

const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

/**
 * /{firm}/packages/{packageId} (Client Portal Review One SP-1, Services & Pricing S7, S12): a
 * package's booking link. It is read without signing in and shows only while the firm has it
 * Active, Visible to Clients and set to Display on Website/Portal: what it includes, what it does
 * not include, its price and, when allowed, its add-ons. Never internal notes. Anything else is
 * refused here with the firm's contact.
 */
export function PackageLinkScreen({ packageId }: { packageId: string }) {
  const { business } = usePortal();
  const slug = business.slug;
  const pkg = useApiQuery(['public-package', slug, packageId], () =>
    api.publicPackages(slug).get(packageId),
  );
  const details = pkg.data?.state === 'LIVE' ? pkg.data.details : null;
  return (
    <SignUpFrame
      heading="Our"
      highlight="Packages"
      intro={`A package from ${business.name}, with everything it includes.`}
      benefits={BENEFITS}
    >
      <div data-testid="package-link" className="grid gap-5">
        {pkg.isPending ? (
          <>
            <StepHeading title="Package">Loading the package…</StepHeading>
            <Skeleton className="h-24 w-full" />
          </>
        ) : details ? (
          <Offered details={details} />
        ) : (
          <Refused pkg={pkg.data} failed={pkg.isError && !isGone(pkg.error)} />
        )}
      </div>
    </SignUpFrame>
  );
}

/** No such package at this firm (or an id that can't be one): the link does not work. */
const isGone = (error: unknown) => {
  const code = errorCode(error);
  return code === 'NOT_FOUND' || code === 'VALIDATION_FAILED';
};

function Offered({ details }: { details: PublicPackageDetails }) {
  const { business, signUpOpen } = usePortal();
  const slug = business.slug;
  return (
    <>
      <StepHeading title={details.name}>{details.shortDescription}</StepHeading>
      <dl
        data-testid="package-price"
        className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-card border border-border bg-surface p-4 text-base"
      >
        {details.category ? (
          <>
            <dt className="font-semibold text-heading">Category</dt>
            <dd className="text-text">{details.category}</dd>
          </>
        ) : null}
        <dt className="font-semibold text-heading">Price</dt>
        <dd className="text-text">
          {details.packagePriceCents === null
            ? 'Quoted by the firm'
            : money(details.packagePriceCents)}
        </dd>
        {details.savingsCents ? (
          <>
            <dt className="font-semibold text-heading">You save</dt>
            <dd className="text-success">{money(details.savingsCents)}</dd>
          </>
        ) : null}
      </dl>
      <section aria-labelledby="package-included" className="grid gap-2">
        <h2 id="package-included" className="font-semibold text-heading">
          What&apos;s included
        </h2>
        <ul data-testid="package-included" className="grid gap-1">
          {details.included.map((s) => (
            <li key={s.name} className="flex items-center gap-2 text-text">
              <CheckCircle2 aria-hidden className="size-5 shrink-0 text-success" />
              {s.name}
            </li>
          ))}
        </ul>
      </section>
      {details.notIncluded.length ? (
        <section aria-labelledby="package-not-included" className="grid gap-2">
          <h2 id="package-not-included" className="font-semibold text-heading">
            Not included
          </h2>
          <ul data-testid="package-not-included" className="grid gap-1">
            {details.notIncluded.map((s) => (
              <li key={s.name} className="flex items-center gap-2 text-text">
                <XCircle aria-hidden className="size-5 shrink-0 text-muted" />
                {s.name}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {details.addOns.length ? (
        <section aria-labelledby="package-add-ons" className="grid gap-2">
          <h2 id="package-add-ons" className="font-semibold text-heading">
            Optional add-ons
          </h2>
          <ul data-testid="package-add-ons" className="grid gap-1">
            {details.addOns.map((a) => (
              <li key={a.name} className="flex flex-wrap justify-between gap-2 text-text">
                <span>
                  {a.name}
                  {a.description ? (
                    <span className="block text-sm text-muted">{a.description}</span>
                  ) : null}
                </span>
                <span className="font-semibold">+ {money(a.priceCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <ButtonLink href={`/${slug}/sign-in`}>Sign In to Get Started</ButtonLink>
      {signUpOpen ? (
        <p data-testid="package-link-sign-up" className="text-center text-text">
          New to {business.name}?{' '}
          <Link className="text-link underline" href={`/${slug}/sign-up`}>
            Create an account
          </Link>
          , then ask the firm about {details.name} from your portal.
        </p>
      ) : null}
      <div className="rounded-card border border-border bg-surface p-4">
        <p className="mb-2 font-semibold text-heading">Questions? Contact {business.name}</p>
        <FirmContactLinks />
      </div>
    </>
  );
}

/** Hidden, a draft, inactive, archived, or no such package: refused, with the firm's contact. */
function Refused({ pkg, failed }: { pkg: PublicPackage | undefined; failed: boolean }) {
  const { business } = usePortal();
  const [title, text] = failed
    ? [
        'This Page Did Not Load',
        'Something went wrong. Try again in a moment, or contact the firm.',
      ]
    : pkg?.state === 'ARCHIVED'
      ? [
          'This Package Is No Longer Offered',
          `${business.name} no longer offers this package. Contact the firm about its services.`,
        ]
      : pkg
        ? [
            'This Package Isn’t Available Online',
            `${business.name} doesn't offer this package online right now. Contact the firm to ask about it.`,
          ]
        : [
            'This Package Link Does Not Work',
            `It is not one of ${business.name}'s packages. Check the link, or contact the firm.`,
          ];
  return (
    <>
      <div role="alert" data-testid="package-link-refused">
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
