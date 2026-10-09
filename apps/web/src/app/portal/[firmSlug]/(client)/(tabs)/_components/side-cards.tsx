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
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  href: string;
  action: string;
}) {
  return (
    <Card className="flex gap-3">
      <Icon aria-hidden className="size-10 shrink-0 text-firm-accent" />
      <div className="min-w-0">
        <h2 className="font-display text-lg font-bold text-heading">{title}</h2>
        <div className="my-1 text-sm text-text">{children}</div>
        <Link href={href} className="inline-flex items-center gap-2 text-link underline">
          {action} <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
    </Card>
  );
}

/** Need Help, the next appointment, and the two document shortcuts. */
export function RightColumn({ slug }: { slug: string }) {
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
      <LinkCard
        icon={FileUp}
        title="My Uploaded Documents"
        href={`/${slug}/documents`}
        action="View My Uploads"
      >
        View documents you uploaded to the portal.
      </LinkCard>
      <LinkCard
        icon={FolderOpen}
        title="Firm Uploaded Documents"
        href={`/${slug}/business`}
        action="View Firm Documents"
      >
        View documents shared with you by the firm.
      </LinkCard>
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
export function QuickLinks({ slug }: { slug: string }) {
  return (
    <Card>
      <h2 className="mb-2 font-display text-2xl font-bold text-heading">Quick Links</h2>
      <ul className="divide-y divide-border">
        {quickLinks(slug).map(([Icon, title, description, href]) => (
          <li key={title}>
            <Link href={href} className="flex items-center gap-3 py-2 hover:bg-folder-surface">
              <Icon aria-hidden className="size-8 shrink-0 text-firm-accent" />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-heading">{title}</span>
                <span className="block text-sm text-text">{description}</span>
              </span>
              <ChevronRight aria-hidden className="size-5 shrink-0 text-firm-accent" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
