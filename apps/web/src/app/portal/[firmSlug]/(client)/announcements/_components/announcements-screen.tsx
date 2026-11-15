'use client';

import { Badge, Card } from '@firmivra/ui';
import { Megaphone } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { api } from '../../../../../../lib/api';
import { PageState } from '../../../../../../components/page-state';
import { AnnouncementText, useAnnouncements } from '../../_components/announcements';
import { PortalPageHeader } from '../../_components/portal-page-header';

/** View All Announcements: every live announcement published to the client, newest first. */
export function AnnouncementsScreen() {
  const { firmSlug: slug } = useParams<{ firmSlug: string }>();
  const query = useAnnouncements(slug);
  // C26: shown here in full, each one counts as opened in its Results, once per visit.
  const counted = useRef(new Set<string>());
  useEffect(() => {
    for (const a of query.data?.items ?? []) {
      if (counted.current.has(a.id)) continue;
      counted.current.add(a.id);
      void api
        .myAnnouncements(slug)
        .opened(a.id)
        .catch(() => undefined);
    }
  }, [query.data, slug]);
  return (
    <div className="flex flex-col gap-6">
      <PortalPageHeader title="Announcements" subtitle="News and updates from your firm." />
      <PageState
        query={query}
        isEmpty={(data) => data.items.length === 0}
        empty="No announcements right now."
      >
        {(data) => (
          <ul className="grid gap-4">
            {data.items.map((announcement) => (
              <li key={announcement.id}>
                <Card>
                  <div className="flex items-center gap-2">
                    <Megaphone aria-hidden className="size-6 shrink-0 text-purple" />
                    <Badge tone="purple">Announcement</Badge>
                  </div>
                  <AnnouncementText announcement={announcement} />
                </Card>
              </li>
            ))}
          </ul>
        )}
      </PageState>
    </div>
  );
}
