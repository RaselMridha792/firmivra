'use client';

import { Timeline, type TimelineItem } from '@firmivra/ui';
import { Envelope } from '@phosphor-icons/react';
import { InfoCard } from './detail-cards';
import { useDetail } from './detail-frame';
import { eventMeta, stamp } from './detail-shared';

/** Communication tab: the form sent, resent and reminded, newest first. */
export function CommunicationTab() {
  const { record, loading } = useDetail();
  const items: TimelineItem[] = [...(record?.communications ?? [])]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .map((e) => ({
      id: e.id,
      icon: eventMeta(e.kind).icon,
      tone: eventMeta(e.kind).tone,
      title: e.label,
      time: stamp(e.at),
      dateTime: e.at,
      ...(e.by ? { actor: e.by } : {}),
    }));
  return (
    <InfoCard icon={Envelope} title="Communication" edit={false} testId="communication">
      <Timeline
        items={items}
        variant="rail"
        label="Communication history"
        emptyText={
          loading
            ? 'Loading…'
            : record
              ? 'Nothing was sent for this form yet.'
              : 'The communication history is not available right now.'
        }
      />
    </InfoCard>
  );
}
