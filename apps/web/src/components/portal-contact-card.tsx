'use client';

import type { MyPortalContact, PortalOfficeContact } from '@firmivra/types';
import { Building2, Mail, MapPin, MessageSquareText, Phone } from 'lucide-react';
import type { ReactNode } from 'react';
import { phoneLabel, telHref } from '../lib/firm-contact';

// The portal's contact offices (Client Portal guide 4 and 9.4, PRT-3): the corporate office and
// the client's local office as the firm shows them, each with only the contact methods it allows.
// The portal draws them inside its Need Help card; Settings' Live Preview draws the same lines
// without following them. Send a Message and Book Appointment are each caller's own buttons.

type Tone = 'brand' | 'light';

function Line({
  href,
  icon: Icon,
  children,
}: {
  href: string | null;
  icon: typeof Phone;
  children: ReactNode;
}) {
  const body = (
    <>
      <Icon aria-hidden className="size-4 shrink-0" />
      {children}
    </>
  );
  return (
    <li>
      {href ? (
        <a
          href={href}
          className="inline-flex min-h-8 min-w-0 items-center gap-2 break-all underline-offset-2 hover:underline"
        >
          {body}
        </a>
      ) : (
        <span className="inline-flex min-h-8 min-w-0 items-center gap-2 break-all">{body}</span>
      )}
    </li>
  );
}

function Office({
  office,
  title,
  icon: Icon,
  methods,
  live,
  tone,
  testId,
}: {
  office: PortalOfficeContact;
  title: string;
  icon: typeof Phone;
  methods: MyPortalContact['methods'];
  live: boolean;
  tone: Tone;
  testId: string;
}) {
  const muted = tone === 'brand' ? 'opacity-90' : 'text-muted';
  const phone = methods.phone ? office.phone : null;
  const text = methods.sms ? office.phone : null;
  const email = methods.email ? office.email : null;
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-1">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Icon aria-hidden className="size-4 shrink-0" />
        {title}
      </h3>
      <p className="text-sm font-semibold">{office.name}</p>
      {office.addressLines.length ? (
        <p className={`text-sm ${muted}`}>
          {office.addressLines.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </p>
      ) : null}
      {phone || text || email ? (
        <ul data-testid={testId} className="text-sm">
          {phone ? (
            <Line href={live ? telHref(phone) : null} icon={Phone}>
              {phoneLabel(phone)}
            </Line>
          ) : null}
          {text ? (
            <Line
              href={live ? `sms:${text.replace(/[^\d+]/g, '')}` : null}
              icon={MessageSquareText}
            >
              Text {phoneLabel(text)}
            </Line>
          ) : null}
          {email ? (
            <Line href={live ? `mailto:${email}` : null} icon={Mail}>
              {email}
            </Line>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}

/** The offices the firm shows; nothing when it shows neither. */
export function PortalContactDetails({
  contact,
  live,
  tone,
}: {
  contact: MyPortalContact;
  /** False in a preview: the lines show but are not links. */
  live: boolean;
  tone: Tone;
}) {
  const { corporate, local, methods } = contact;
  if (!corporate && !local) return null;
  const divider = tone === 'brand' ? 'border-current/30' : 'border-divider';
  return (
    <div className="flex flex-col gap-3" data-testid="portal-contact-details">
      {corporate ? (
        <Office
          office={corporate}
          title="Corporate Office"
          icon={Building2}
          methods={methods}
          live={live}
          tone={tone}
          testId="firm-contact"
        />
      ) : null}
      {local ? (
        <div className={corporate ? `border-t pt-3 ${divider}` : ''}>
          <Office
            office={local}
            title="Your Local Office"
            icon={MapPin}
            methods={methods}
            live={live}
            tone={tone}
            testId="local-contact"
          />
        </div>
      ) : null}
    </div>
  );
}
