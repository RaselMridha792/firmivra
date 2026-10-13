'use client';

import { Card } from '@firmivra/ui';
import {
  ArrowRight,
  CalendarDays,
  ChevronRight,
  CloudUpload,
  FileUp,
  FolderOpen,
  Mail,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { ButtonLink } from '../../../(public)/_components/button-link';
import { NotesCard } from '../messages/_components/notes-card';
import { HelpfulResources } from '../business/_components/business-cards';

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
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  href: string;
  action: string;
  blueAccent?: boolean;
}) {
  return (
    <Card className="flex gap-3">
      <Icon
        aria-hidden
        className={`size-10 shrink-0 ${blueAccent ? 'text-firm-primary' : 'text-firm-accent'}`}
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

/** Need Help, appointment and document shortcuts; Messages also places Notes here. */
export function RightColumn({
  slug,
  isMessagesPage = false,
  blueAccents = false,
  businessPage = false,
}: {
  slug: string;
  isMessagesPage?: boolean;
  blueAccents?: boolean;
  businessPage?: boolean;
}) {
  return isMessagesPage ? (
    <MessagesRightColumn slug={slug} />
  ) : (
    <DefaultRightColumn slug={slug} blueAccents={blueAccents} businessPage={businessPage} />
  );
}

function MessagesRightColumn({ slug }: { slug: string }) {
  const upcoming = useApiQuery(['my-appointments', slug, 'upcoming'], () =>
    api.myAppointments(slug).list({ when: 'upcoming' }),
  );
  const next = upcoming.data?.[0];
  return (
    <aside
      aria-label="Help, appointments, and notes"
      className="flex w-full flex-col gap-4 lg:w-72"
    >
      <Card className="bg-firm-primary! text-on-action">
        <h2 className="font-display text-2xl font-bold">Need Help?</h2>
        <p className="my-3 text-sm">Our team is here for you.</p>
        <ButtonLink href={`/${slug}/messages`} className="cursor-pointer">
          Send a Message
        </ButtonLink>
      </Card>
      <LinkCard
        icon={CalendarDays}
        title="Upcoming Appointment"
        href={`/${slug}/appointments`}
        action={next ? 'View Appointment' : 'Schedule Now'}
        blueAccent
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
      <NotesCard slug={slug} />
    </aside>
  );
}

function DefaultRightColumn({
  slug,
  blueAccents,
  businessPage,
}: {
  slug: string;
  blueAccents: boolean;
  businessPage: boolean;
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
      {businessPage ? (
        <HelpfulResources slug={slug} compact />
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

const quickLinks = (slug: string): [LucideIcon, string, string, string][] => [
  [CloudUpload, 'Upload Documents', 'Securely upload your tax documents.', `/${slug}/documents`],
  [CalendarDays, 'Schedule an Appointment', 'Book a time with our team.', `/${slug}/appointments`],
  [Mail, 'Send a Message', 'Get answers to your questions.', `/${slug}/messages`],
  [UserRound, 'Update My Profile', 'Keep your information current.', `/${slug}/profile`],
];

/** "Quick Links" under the folder tabs. */
export function QuickLinks({
  slug,
  useSidebarBlue = false,
  businessLayout = false,
}: {
  slug: string;
  useSidebarBlue?: boolean;
  businessLayout?: boolean;
}) {
  return (
    <Card>
      <h2 className="mb-2 font-display text-2xl font-bold text-heading">Quick Links</h2>
      <ul
        className={
          businessLayout ? 'grid grid-cols-2 gap-2 2xl:grid-cols-4' : 'divide-y divide-border'
        }
      >
        {quickLinks(slug).map(([Icon, title, description, href]) => (
          <li key={title}>
            <Link
              href={href}
              className={
                businessLayout
                  ? 'flex h-full flex-col items-center justify-center gap-2 rounded-card border border-folder-border p-3 text-center hover:bg-folder-surface'
                  : 'flex items-center gap-3 py-2 hover:bg-folder-surface'
              }
            >
              <Icon
                aria-hidden
                className={`size-8 shrink-0 ${useSidebarBlue ? 'text-firm-primary' : 'text-firm-accent'}`}
              />
              <span className={businessLayout ? 'min-w-0' : 'min-w-0 flex-1'}>
                <span className="block font-semibold text-heading">{title}</span>
                <span className={`block text-sm text-text ${businessLayout ? 'sr-only' : ''}`}>
                  {description}
                </span>
              </span>
              {!businessLayout ? (
                <ChevronRight
                  aria-hidden
                  className={`size-5 shrink-0 ${useSidebarBlue ? 'text-firm-primary' : 'text-firm-accent'}`}
                />
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
