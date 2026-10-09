import { Card } from '@firmivra/ui';
import { BriefcaseBusiness } from 'lucide-react';
import Link from 'next/link';
import { errorCode } from '../../../../../../lib/errors';

/** True when the API refused because these pages are for business clients only. */
export const isBusinessOnly = (error: unknown) => errorCode(error) === 'BUSINESS_ONLY';

/** What an INDIVIDUAL client sees on a business-only page (403 BUSINESS_ONLY). */
export function BusinessOnly({ slug }: { slug: string }) {
  return (
    <Card data-testid="business-only" className="grid justify-items-center gap-3 text-center">
      <BriefcaseBusiness aria-hidden className="size-12 text-firm-accent" />
      <h2 className="font-display text-2xl font-bold text-heading">For business clients</h2>
      <p className="max-w-modal text-text">
        These resources are for business clients. If you have a business service with us, send us a
        message and we&apos;ll update your account.
      </p>
      <Link className="text-link underline" href={`/${slug}/messages`}>
        Send a Message
      </Link>
    </Card>
  );
}
