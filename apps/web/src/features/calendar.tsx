'use client';

import { useState } from 'react';
import { Button, Card, Input, Select } from '@firmivra/ui';
import { useWorkspace } from '../components/workspace-context';
import { DataNotice, PageHeading, RecordLink, UnavailableAction } from './screen-kit';

const zones = ['Asia/Dhaka', 'America/New_York', 'Europe/London', 'UTC'];
const dateLabel = (date: Date) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
export function Calendar() {
  const { preview } = useWorkspace();
  const [date, setDate] = useState(() =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date()),
  );
  const [view, setView] = useState('week');
  const [zone, setZone] = useState('Asia/Dhaka');
  const current = new Date(`${date}T12:00:00Z`);
  const start = new Date(current);
  if (view === 'week') start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const days = Array.from({ length: view === 'week' ? 7 : 1 }, (_, i) => {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + i);
    return day;
  });
  function shift(amount: number) {
    const next = new Date(current);
    next.setUTCDate(next.getUTCDate() + amount * (view === 'week' ? 7 : 1));
    setDate(next.toISOString().slice(0, 10));
  }
  return (
    <>
      <PageHeading
        title="Calendar"
        description="Review appointments and your team’s availability."
        action={
          <UnavailableAction label="New appointment">
            <Input label="Client" required />
            <Input label="Appointment title" required />
            <Input label="Date" type="date" required />
            <Input label="Time" type="time" required />
            <Select
              label="Method"
              options={['In person', 'Phone', 'Video'].map((value) => ({ value, label: value }))}
            />
            <Input label="Location or video link" />
          </UnavailableAction>
        }
      />
      <DataNotice />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          label="Calendar date"
          type="date"
          value={date}
          onChange={(e) => {
            if (e.target.value) setDate(e.target.value);
          }}
        />
        <Select
          label="View"
          value={view}
          onChange={(e) => setView(e.target.value)}
          options={[
            { value: 'day', label: 'Day' },
            { value: 'week', label: 'Week' },
          ]}
        />
        <Select
          label="Time zone"
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          options={zones.map((value) => ({ value, label: value }))}
        />
        <Select
          label="Team member"
          options={[
            { value: 'all', label: 'All staff' },
            ...(preview ? [{ value: 'sample', label: 'Sample staff member' }] : []),
          ]}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => shift(-1)}>
            Previous
          </Button>
          <Button variant="secondary" onClick={() => shift(1)}>
            Next
          </Button>
        </div>
        <RecordLink href="/availability">Manage availability →</RecordLink>
      </div>
      <Card title={`${view === 'week' ? 'Week' : 'Day'} of ${dateLabel(start)} · ${zone}`}>
        <div className="overflow-x-auto">
          <div className={`grid gap-3 ${view === 'week' ? 'ui-calendar min-w-public' : ''}`}>
            {days.map((day, i) => (
              <section key={day.toISOString()} className="rounded-card border border-border">
                <h2 className="bg-folder-surface p-3 text-sm font-semibold text-heading">
                  {dateLabel(day)}
                </h2>
                <div className="space-y-3 p-3">
                  {['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00'].map(
                    (time) => (
                      <div key={time} className="min-h-12 border-b border-border py-2">
                        <p className="text-xs text-muted">{time}</p>
                        {preview && i === 0 && time === '10:00' ? (
                          <div className="mt-2 rounded-control bg-info-soft p-3">
                            <p className="text-sm font-semibold text-info">
                              Sample tax consultation
                            </p>
                            <p className="text-xs">10:00–10:30 · {zone}</p>
                            <UnavailableAction label="View appointment">
                              <p>Sample client · Video · Sample staff</p>
                              <Input label="Reschedule date" type="date" />
                              <Input label="Reschedule time" type="time" />
                            </UnavailableAction>
                          </div>
                        ) : null}
                      </div>
                    ),
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
      </Card>
    </>
  );
}
export function Availability() {
  const [hours, setHours] = useState<
    Record<string, { enabled: boolean; start: string; end: string }>
  >(() =>
    Object.fromEntries(
      ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(
        (day, i) => [day, { enabled: i < 5, start: '09:00', end: '17:00' }],
      ),
    ),
  );
  return (
    <>
      <PageHeading
        title="Availability"
        description="Set working hours and protect time when you are unavailable."
      />
      <RecordLink href="/calendar">← Back to calendar</RecordLink>
      <DataNotice />
      <Card title="Weekly working hours">
        <div className="space-y-4">
          {Object.entries(hours).map(([day, hour]) => (
            <div
              key={day}
              className="grid items-end gap-3 border-b border-border pb-4 sm:grid-cols-3"
            >
              <Select
                label={day}
                value={hour.enabled ? 'open' : 'closed'}
                onChange={(e) =>
                  setHours((h) => ({
                    ...h,
                    [day]: { ...hour, enabled: e.target.value === 'open' },
                  }))
                }
                options={[
                  { value: 'open', label: 'Available' },
                  { value: 'closed', label: 'Unavailable' },
                ]}
              />
              <Input
                label={`${day} start`}
                type="time"
                value={hour.start}
                disabled={!hour.enabled}
                onChange={(e) =>
                  setHours((h) => ({ ...h, [day]: { ...hour, start: e.target.value } }))
                }
              />
              <Input
                label={`${day} end`}
                type="time"
                value={hour.end}
                disabled={!hour.enabled}
                onChange={(e) =>
                  setHours((h) => ({ ...h, [day]: { ...hour, end: e.target.value } }))
                }
              />
            </div>
          ))}
          <Button disabled>Save working hours</Button>
        </div>
      </Card>
      <Card title="Blocked time">
        <UnavailableAction label="Add blocked time">
          <Input label="Start date" type="date" />
          <Input label="Start time" type="time" />
          <Input label="End date" type="date" />
          <Input label="End time" type="time" />
          <Input label="Reason" />
        </UnavailableAction>
      </Card>
    </>
  );
}
