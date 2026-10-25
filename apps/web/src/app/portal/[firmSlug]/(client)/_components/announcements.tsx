'use client';

import type { AnnouncementPlace, MyAnnouncement } from '@firmivra/types';
import { Badge, Card } from '@firmivra/ui';
import { ChevronRight, Megaphone, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';

// Announcements from Communications in the portal (Client Portal guide 3; the design's preview in
// docs/mockups/firm-workspace/settings/review-2026-10-20/client-portal/
// client-portal-announcements-dashboard.jpg): the newest one in a card with an Announcement badge,
// a dismiss button and View All Announcements.

export const useAnnouncements = (slug: string) =>
  useApiQuery(['my-announcements', slug], () => api.myAnnouncements(slug).list());

const dateText = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** Dismissed cards, per firm, in this browser only: View All still lists them. */
const storageKey = (slug: string) => `firmivra:dismissed-announcements:${slug}`;
function readDismissed(slug: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey(slug)) ?? '[]');
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The newest live announcement for this place (its own page, or the dashboard: every My Client
 * Portal tab) that the client has not dismissed here. Nothing when there is none.
 */
export function AnnouncementCard({ slug, place }: { slug: string; place: AnnouncementPlace }) {
  const query = useAnnouncements(slug);
  const [dismissed, setDismissed] = useState(() => readDismissed(slug));
  const first = (query.data?.items ?? []).find(
    (a) => (a.where === place || a.where === 'dashboard') && !dismissed.includes(a.id),
  );
  if (!first) return null;
  const dismiss = () => {
    const next = [...dismissed, first.id].slice(-50);
    setDismissed(next);
    try {
      localStorage.setItem(storageKey(slug), JSON.stringify(next));
    } catch {
      // No storage (private window): the card comes back on the next visit.
    }
  };
  return (
    <Card data-testid="announcement-card" className="relative">
      <div className="flex items-center gap-2 pr-10">
        <Megaphone aria-hidden className="size-6 shrink-0 text-purple" />
        <Badge tone="purple">Announcement</Badge>
      </div>
      <button
        type="button"
        aria-label="Dismiss announcement"
        onClick={dismiss}
        className="absolute top-4 right-4 grid size-9 place-items-center rounded-control text-muted hover:bg-folder-surface focus-visible:outline-2 focus-visible:outline-focus"
      >
        <X aria-hidden className="size-5" />
      </button>
      <AnnouncementText announcement={first} clamp />
      <Link
        href={`/${slug}/announcements`}
        className="mt-4 flex min-h-11 items-center justify-between gap-2 rounded-control border border-action px-4 text-sm font-semibold text-action hover:bg-accent-soft"
      >
        View All Announcements
        <ChevronRight aria-hidden className="size-4 shrink-0" />
      </Link>
    </Card>
  );
}

/** An announcement's title, date and text, its lines kept. */
export function AnnouncementText({
  announcement,
  clamp = false,
}: {
  announcement: MyAnnouncement;
  clamp?: boolean;
}) {
  return (
    <>
      <h2 className="mt-3 font-display text-xl font-bold text-heading">
        {announcement.title ?? 'Announcement'}
      </h2>
      <p className="mt-1 text-xs text-muted">Posted {dateText(announcement.publishedAt)}</p>
      <p className={`mt-2 text-sm whitespace-pre-line text-text ${clamp ? 'line-clamp-5' : ''}`}>
        {announcement.body}
      </p>
    </>
  );
}
