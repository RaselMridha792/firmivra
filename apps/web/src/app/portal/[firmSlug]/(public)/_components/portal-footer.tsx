'use client';

import { Button, PageContainer, type PageWidth } from '@firmivra/ui';
import type { LegalKind } from '@firmivra/types';
import { Mail, MapPin, Phone } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { usePortal } from '../../layout';
import lvpLogoWhite from '../begin/_blocks/lvp-logo-white.png';
import { LegalDialog } from './legal-dialog';
import { taglineWords } from './tagline';

const YEAR = new Date().getFullYear();
const ROW = 'flex flex-wrap items-center gap-4 py-4';
const linkStyle = 'block rounded-sm py-0.5 text-xs text-on-action hover:text-firm-accent';

type FooterItem = { label: string; href?: string; legal?: LegalKind };

/** The portal footer: LVP follows the client-portal mockup; other firms keep their compact footer. */
export function PortalFooter({ contact = false, width }: { contact?: boolean; width?: PageWidth }) {
  const { business, branding, legal } = usePortal();
  const [kind, setKind] = useState<LegalKind | null>(null);
  const motto = taglineWords(branding);
  const links = [
    ...(['privacy', 'terms'] as const)
      .filter((item) => legal[item])
      .map((item) => (
        <Button key={item} variant="ghost" onClick={() => setKind(item)}>
          {item === 'terms' ? 'Terms of Service' : 'Privacy Policy'}
        </Button>
      )),
    ...(contact
      ? [
          <Link key="contact" href={`/${business.slug}/messages`}>
            Contact Us
          </Link>,
        ]
      : []),
  ];

  if (business.slug === 'lvp' && width === 'public') {
    const columns: { title: string; items: FooterItem[] }[] = [
      {
        title: 'Quick Links',
        items: [
          { label: 'Home', href: `/${business.slug}` },
          { label: 'Services', href: `/${business.slug}/begin` },
          { label: 'Client Portal', href: `/${business.slug}/sign-in` },
          { label: 'Contact', href: 'mailto:info@LVPAccounting.com' },
          { label: 'Resources', href: `/${business.slug}/calculators` },
          { label: 'About', href: `/${business.slug}` },
          { label: 'Book an Appointment', href: `/${business.slug}/appointments` },
        ],
      },
      {
        title: 'Our Services',
        items: [
          { label: 'Tax Preparation', href: `/${business.slug}/begin/annual-tax` },
          { label: 'Bookkeeping', href: `/${business.slug}/begin/bookkeeping` },
          {
            label: 'Business Formation & Setup',
            href: `/${business.slug}/begin/business-development`,
          },
          { label: 'Payroll Support', href: `/${business.slug}/begin/payroll` },
          { label: '1099 / W-2 Support', href: `/${business.slug}/begin/payroll` },
          { label: 'Business Development', href: `/${business.slug}/begin/business-development` },
          { label: 'Ongoing Business Support', href: `/${business.slug}/begin` },
        ],
      },
      {
        title: 'Resources',
        items: [
          { label: 'Blog' },
          { label: 'Tax Tips' },
          { label: 'FAQs' },
          { label: 'Tax Forms', href: `/${business.slug}/begin/annual-tax` },
          { label: 'Financial Tools', href: `/${business.slug}/calculators` },
        ],
      },
      {
        title: 'Legal',
        items: [
          ...(legal.privacy ? [{ label: 'Privacy Policy', legal: 'privacy' as const }] : []),
          ...(legal.terms ? [{ label: 'Terms of Service', legal: 'terms' as const }] : []),
          { label: 'Disclaimer' },
          { label: 'Refund Policy' },
          { label: 'Accessibility' },
        ],
      },
    ];

    return (
      <>
        <footer className="border-t border-border bg-firm-primary text-on-action">
          <PageContainer
            width={width ?? 'public'}
            className="grid grid-cols-2 gap-x-6 gap-y-8 py-8 md:grid-cols-3 lg:grid-cols-7 lg:py-10"
          >
            <section className="col-span-2 md:col-span-3 lg:col-span-2">
              <Link href={`/${business.slug}`} className="inline-flex min-h-14 items-center">
                <Image
                  src={lvpLogoWhite}
                  alt={business.name}
                  className="h-16 w-auto object-contain"
                />
              </Link>
              <p className="mt-3 max-w-xs text-xs leading-relaxed text-on-action">
                Tax preparation, accounting, and business support for individuals and small
                businesses. Let&apos;s build a brighter financial future together.
              </p>
              <div aria-hidden className="mt-4 flex items-center gap-3">
                <span className="flex size-8 items-center justify-center text-firm-accent">
                  <svg viewBox="0 0 24 24" className="size-5 fill-current" aria-hidden="true">
                    <path d="M13.4 21v-8.2h2.8l.4-3.2h-3.2V7.5c0-.9.3-1.5 1.6-1.5h1.7V3.1c-.3 0-1.4-.1-2.6-.1-2.6 0-4.4 1.6-4.4 4.4v2.2H7v3.2h2.7V21h3.7Z" />
                  </svg>
                </span>
                <span className="flex size-8 items-center justify-center text-firm-accent">
                  <svg
                    viewBox="0 0 24 24"
                    className="size-5 fill-none stroke-current"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="5" />
                    <circle cx="12" cy="12" r="4" />
                    <circle cx="18" cy="6" r="1" className="fill-current stroke-none" />
                  </svg>
                </span>
                <span className="flex size-8 items-center justify-center text-firm-accent">
                  <svg viewBox="0 0 24 24" className="size-5 fill-current" aria-hidden="true">
                    <path d="M5.2 8.2H2.8v13h2.4v-13ZM4 6.9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm6.4 1.3H8v13h2.5v-6.8c0-1.8.3-3.6 2.6-3.6 2.3 0 2.3 2.1 2.3 3.7v6.7h2.5v-7.5c0-3.7-1.1-5.7-4.4-5.7-1.6 0-2.8.9-3.3 1.7h-.1V8.2Z" />
                  </svg>
                </span>
                <span className="flex size-8 items-center justify-center text-firm-accent">
                  <svg viewBox="0 0 24 24" className="size-5 fill-current" aria-hidden="true">
                    <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.6 3.6 12 3.6 12 3.6s-7.6 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.8.5 9.4.5 9.4.5s7.6 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8ZM9.5 15.6V8.4L15.8 12l-6.3 3.6Z" />
                  </svg>
                </span>
              </div>
            </section>

            {columns.map((column) => (
              <section
                key={column.title}
                className="min-w-0 lg:border-l lg:border-firm-accent lg:pl-4"
              >
                <h2 className="mb-2 text-sm font-semibold text-on-action">{column.title}</h2>
                <ul className="space-y-0.5">
                  {column.items.map((item) => (
                    <li key={item.label} className="min-w-0 break-words">
                      {item.legal ? (
                        <button
                          type="button"
                          className={linkStyle}
                          onClick={() => setKind(item.legal ?? null)}
                        >
                          {item.label}
                        </button>
                      ) : item.href ? (
                        <Link className={linkStyle} href={item.href}>
                          {item.label}
                        </Link>
                      ) : (
                        <span className={linkStyle}>{item.label}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            <section className="min-w-0 lg:border-l lg:border-firm-accent lg:pl-4">
              <h2 className="mb-2 text-sm font-semibold text-on-action">Office Hours</h2>
              <p className="text-xs leading-relaxed">
                Monday - Friday
                <br />
                9:00 AM - 6:00 PM
              </p>
              <p className="mt-2 text-xs leading-relaxed">
                Saturday
                <br />
                By Appointment Only
              </p>
              <p className="mt-2 text-xs leading-relaxed">
                Sunday
                <br />
                Closed
              </p>
            </section>
          </PageContainer>

          <div className="border-t-2 border-firm-accent">
            <PageContainer
              width={width ?? 'public'}
              className="flex flex-col items-start gap-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
            >
              <div className="flex items-center gap-2 text-xs leading-relaxed">
                <MapPin aria-hidden className="size-5 shrink-0 text-firm-accent" />
                <span>
                  1393 Duncan Lane, Unit 100
                  <br />
                  Auburn, GA 30011
                </span>
              </div>
              <a
                href="tel:+17701234567"
                className="flex items-center gap-2 text-xs hover:text-firm-accent xl:border-l xl:border-firm-accent xl:pl-3"
              >
                <Phone aria-hidden className="size-5 shrink-0 text-firm-accent" />
                <span>(770) 123-4567</span>
              </a>
              <a
                href="mailto:info@LVPAccounting.com"
                className="flex min-w-0 items-center gap-2 break-all text-xs hover:text-firm-accent xl:border-l xl:border-firm-accent xl:pl-3"
              >
                <Mail aria-hidden className="size-5 shrink-0 text-firm-accent" />
                <span>info@LVPAccounting.com</span>
              </a>
              <span className="flex items-center text-xs leading-relaxed xl:whitespace-nowrap xl:border-l xl:border-firm-accent xl:pl-3">
                © {YEAR}{' '}
                <span data-testid="firm-name" className="mx-1">
                  {business.name}
                </span>
                . All rights reserved.
              </span>
            </PageContainer>
          </div>
        </footer>
        <LegalDialog slug={business.slug} kind={kind} onClose={() => setKind(null)} />
      </>
    );
  }

  const items = (
    <>
      <span>
        © {YEAR} <span data-testid="firm-name">{business.name}</span>. All rights reserved.
      </span>
      <span className="flex flex-wrap items-center gap-2 md:ml-auto [&_button]:text-on-action [&_button:hover]:text-firm-primary">
        {links.map((link, index) => (
          <span key={link.key} className="flex items-center gap-2">
            {index > 0 ? <span aria-hidden>|</span> : null}
            {link}
          </span>
        ))}
      </span>
      {contact && motto.length > 0 ? (
        <span className="font-display text-lg text-firm-accent italic">{motto.join(' / ')}</span>
      ) : (
        <span>Powered by Firmivra</span>
      )}
    </>
  );
  return (
    <footer className="border-t border-border bg-firm-primary text-sm text-on-action">
      {width ? (
        <PageContainer width={width} className={ROW}>
          {items}
        </PageContainer>
      ) : (
        <div className={`px-4 md:px-6 ${ROW}`}>{items}</div>
      )}
      <LegalDialog slug={business.slug} kind={kind} onClose={() => setKind(null)} />
    </footer>
  );
}
