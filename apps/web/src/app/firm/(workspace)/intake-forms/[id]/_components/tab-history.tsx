'use client';

import { Timeline, type TimelineItem } from '@firmivra/ui';
import { ClockCounterClockwise } from '@phosphor-icons/react';
import { InfoCard } from './detail-cards';
import { useDetail } from './detail-frame';
import { eventMeta, stamp } from './detail-shared';

/** History tab: everything that happened to the form, oldest first, who did it and when. */
export function HistoryTab() {
  const { record, loading } = useDetail();
  const items: TimelineItem[] = [...(record?.history ?? [])]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
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
    <InfoCard
      icon={ClockCounterClockwise}
      tone="purple"
      title="Activity Timeline"
      edit={false}
      testId="history"
    >
      <Timeline
        items={items}
        variant="connected"
        label="Form history"
        emptyText={
          loading
            ? 'Loading…'
            : record
              ? 'No activity yet.'
              : 'The history is not available right now.'
        }
      />
    </InfoCard>
  );
}
