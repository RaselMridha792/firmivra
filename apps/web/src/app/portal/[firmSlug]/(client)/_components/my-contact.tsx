'use client';

import { Mail, Phone } from 'lucide-react';
import { PortalContactDetails } from '../../../../../components/portal-contact-card';
import { api } from '../../../../../lib/api';
import { phoneLabel, telHref } from '../../../../../lib/firm-contact';
import { useApiQuery } from '../../../../../lib/query';
import { FirmContactLinks } from '../../(public)/_components/firm-contact';
import { usePortalTabs } from './portal-tabs';

// The signed-in client's contact details as the firm shows them (Settings > Client portal >
// Contact Information, PRT-3): the corporate office and their local office, and only the methods
// the firm allows. The public pages keep the firm's own contact (portal info).

export function useMyContact(slug: string) {
  return useApiQuery(['my-contact', slug], () => api.portalContact.mine(slug));
}

/** Whether Send a Message belongs on the page: the firm allows it and Messages is on. */
export function useMessagesAllowed(slug: string): boolean {
  const tabOn = usePortalTabs(slug);
  const contact = useMyContact(slug);
  return tabOn('messages') && contact.data?.methods.secureMessage !== false;
}

/** Whether Book Appointment belongs in the contact card (the firm's switch). */
export function useAppointmentsAllowed(slug: string): boolean {
  return useMyContact(slug).data?.methods.appointment === true;
}

/** The Need Help card's offices, in the card's colour; the firm's own lines if the call fails. */
export function MyContactCard({ slug, className = '' }: { slug: string; className?: string }) {
  const contact = useMyContact(slug);
  if (contact.isError) return <FirmContactLinks className={className} />;
  if (!contact.data) return null;
  return (
    <div className={className}>
      <PortalContactDetails contact={contact.data} live tone="brand" />
    </div>
  );
}

/** One office's phone and email as links: the corporate office when shown, else the local one. */
export function MyContactLinks({ slug, className = '' }: { slug: string; className?: string }) {
  const contact = useMyContact(slug);
  const c = contact.data;
  if (contact.isError) return <FirmContactLinks className={className} />;
  const office = c?.corporate ?? c?.local ?? null;
  const phone = c?.methods.phone ? office?.phone : null;
  const email = c?.methods.email ? office?.email : null;
  if (!phone && !email) return null;
  return (
    <ul data-testid="firm-contact" className={`space-y-1 text-sm ${className}`}>
      {phone ? (
        <li>
          <a
            href={telHref(phone)}
            className="inline-flex min-h-8 items-center gap-2 underline-offset-2 hover:underline"
          >
            <Phone aria-hidden className="size-4 shrink-0" />
            {phoneLabel(phone)}
          </a>
        </li>
      ) : null}
      {email ? (
        <li>
          <a
            href={`mailto:${email}`}
            className="inline-flex min-h-8 min-w-0 items-center gap-2 break-all underline-offset-2 hover:underline"
          >
            <Mail aria-hidden className="size-4 shrink-0" />
            {email}
          </a>
        </li>
      ) : null}
    </ul>
  );
}
