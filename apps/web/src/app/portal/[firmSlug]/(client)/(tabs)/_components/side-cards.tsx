'use client';

import { Card } from '@firmivra/ui';
import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  CloudUpload,
  FileUp,
  FolderOpen,
  Info,
  Mail,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { ButtonLink } from '../../../(public)/_components/button-link';

const dateTime = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function LinkCard({
  icon: Icon,
  title,
  children,
  href,
  action,
  blueAccent = false,
  compactIcon = false,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  href: string;
  action: string;
  blueAccent?: boolean;
  compactIcon?: boolean;
}) {
  return (
    <Card className="flex gap-3">
      <Icon
        aria-hidden
        className={`${compactIcon ? 'size-8' : 'size-10'} shrink-0 ${blueAccent ? 'text-firm-primary' : 'text-firm-accent'}`}
      />
      <div className="min-w-0">
        <h2 className="font-display text-lg font-bold text-heading">{title}</h2>
        <div className="my-1 text-sm text-text">{children}</div>
        <Link
          href={href}
          className={`inline-flex items-center gap-2 underline ${blueAccent ? 'text-firm-primary' : 'text-link'}`}
        >
          {action} <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
    </Card>
  );
}

/** Need Help, the next appointment, and the two document shortcuts. */
export function RightColumn({
  slug,
  blueAccents = false,
  showInvoiceInfo = false,
}: {
  slug: string;
  blueAccents?: boolean;
  showInvoiceInfo?: boolean;
}) {
  const upcoming = useApiQuery(['my-appointments', slug, 'upcoming'], () =>
    api.myAppointments(slug).list({ when: 'upcoming' }),
  );
  const next = upcoming.data?.[0];
  return (
    <aside aria-label="Help and shortcuts" className="flex w-full flex-col gap-4 lg:w-72">
      <Card className="bg-firm-primary! text-on-action">
        <h2 className="font-display text-2xl font-bold">Need Help?</h2>
        <p className="my-3 text-sm">Our team is here for you.</p>
        <ButtonLink href={`/${slug}/messages`}>Send a Message</ButtonLink>
      </Card>
      <LinkCard
        icon={CalendarDays}
        title="Upcoming Appointment"
        href={`/${slug}/appointments`}
        action={next ? 'View Appointment' : 'Schedule Now'}
        blueAccent={blueAccents}
        compactIcon={showInvoiceInfo}
      >
        {next ? (
          <p data-testid="next-appointment">
            {next.type?.name ?? 'Appointment'} with {next.staffName},{' '}
            {dateTime.format(new Date(next.startsAt))}
          </p>
        ) : (
          <p>No upcoming appointments.</p>
        )}
      </LinkCard>
      {showInvoiceInfo ? (
        <ImportantInfoCard />
      ) : (
        <>
          <LinkCard
            icon={FileUp}
            title="My Uploaded Documents"
            href={`/${slug}/documents`}
            action="View My Uploads"
            blueAccent={blueAccents}
          >
            View documents you uploaded to the portal.
          </LinkCard>
          <LinkCard
            icon={FolderOpen}
            title="Firm Uploaded Documents"
            href={`/${slug}/documents?source=firm`}
            action="View Firm Documents"
            blueAccent={blueAccents}
          >
            View documents shared with you by the firm.
          </LinkCard>
        </>
      )}
    </aside>
  );
}

const invoiceInfo = [
  [
    'How do I cancel my recurring service?',
    'Send an email or message through the portal to request cancellation at least 14 days before your next billing cycle to ensure you are not billed again.',
  ],
  [
    'If I cancel my recurring service, will my business portal still be active?',
    'You will continue to have access to related documents and information for 60 days after cancellation so you can download what you need.',
  ],
  [
    'If I reactivate my account within 90 days, will I still have access to my details?',
    'Yes. If you reactivate within 90 days, your account details and access can be restored.',
  ],
  [
    'What if I need documents after 60 days?',
    'If you need documents after 60 days, please call the office to request copies.',
  ],
];

function ImportantInfoCard() {
  return (
    <Card>
      <div className="flex items-center gap-3">
        <Info aria-hidden className="size-5 shrink-0 text-firm-primary" />
        <h2 className="font-display text-lg font-bold text-heading">Important Info</h2>
      </div>
      <dl className="mt-3 ml-8 divide-y divide-border text-xs">
        {invoiceInfo.map(([question, answer]) => (
          <div key={question} className="py-2 first:pt-0 last:pb-0">
            <dt className="text-sm font-bold text-firm-primary">{question}</dt>
            <dd className="mt-1 text-text">{answer}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

const quickLinks = (slug: string): [LucideIcon, string, string, string][] => [
  [CloudUpload, 'Upload Documents', 'Securely upload your tax documents.', `/${slug}/documents`],
  [CalendarDays, 'Schedule an Appointment', 'Book a time with our team.', `/${slug}/appointments`],
  [Mail, 'Send a Message', 'Get answers to your questions.', `/${slug}/messages`],
  [UserRound, 'Update My Profile', 'Keep your information current.', `/${slug}/profile`],
];

/** "Quick Links" under the folder tabs. */
export function QuickLinks({ slug, blueAccents = false }: { slug: string; blueAccents?: boolean }) {
  return (
    <Card>
      <h2 className="mb-2 font-display text-2xl font-bold text-heading">Quick Links</h2>
      <ul className="divide-y divide-border">
        {quickLinks(slug).map(([Icon, title, description, href]) => (
          <li key={title}>
            <Link href={href} className="flex items-center gap-3 py-2 hover:bg-folder-surface">
              <Icon
                aria-hidden
                className={`size-8 shrink-0 ${blueAccents ? 'text-firm-primary' : 'text-firm-accent'}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-heading">{title}</span>
                <span className="block text-sm text-text">{description}</span>
              </span>
              <ChevronRight
                aria-hidden
                className={`size-5 shrink-0 ${blueAccents ? 'text-firm-primary' : 'text-firm-accent'}`}
              />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
