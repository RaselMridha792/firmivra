'use client';

import { Mail, Phone } from 'lucide-react';
import { phoneLabel, telHref } from '../../../../../lib/firm-contact';
import { usePortal } from '../../layout';

/**
 * The firm's phone and email from Company Profile (or the main office in Locations), as links
 * inside a "Need Help?" card. Takes the card's text colour; nothing when the firm set neither.
 */
export function FirmContactLinks({ className = '' }: { className?: string }) {
  const { contact } = usePortal();
  if (!contact.phone && !contact.email) return null;
  return (
    <ul data-testid="firm-contact" className={`space-y-1 text-sm ${className}`}>
      {contact.phone ? (
        <li>
          <a
            href={telHref(contact.phone)}
            className="inline-flex min-h-8 items-center gap-2 underline-offset-2 hover:underline"
          >
            <Phone aria-hidden className="size-4 shrink-0" />
            {phoneLabel(contact.phone)}
          </a>
        </li>
      ) : null}
      {contact.email ? (
        <li>
          <a
            href={`mailto:${contact.email}`}
            className="inline-flex min-h-8 min-w-0 items-center gap-2 break-all underline-offset-2 hover:underline"
          >
            <Mail aria-hidden className="size-4 shrink-0" />
            {contact.email}
          </a>
        </li>
      ) : null}
    </ul>
  );
}
