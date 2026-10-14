import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { CalendarGrid, type CalendarEvent, type CalendarGridProps } from './index';

const meta = {
  title: 'Firm Backend/CalendarGrid',
  component: CalendarGrid,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof CalendarGrid>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The design's week: Sunday Sep 20 to Saturday Sep 26, 2026, today Monday Sep 21. */
const today = new Date(2026, 8, 21);
const at = (day: number, h: number, m = 0) => new Date(2026, 8, day, h, m);
const event = (
  id: string,
  title: string,
  subtitle: string,
  day: number,
  start: [number, number],
  end: [number, number],
  tone: CalendarEvent['tone'],
): CalendarEvent => ({ id, title, subtitle, start: at(day, ...start), end: at(day, ...end), tone });

const events: CalendarEvent[] = [
  event('1', 'Avery Lawson', 'Consultation', 21, [9, 0], [10, 0], 'blue'),
  event('2', 'Nina Fairbanks', 'Tax Preparation', 21, [11, 0], [12, 0], 'red'),
  event('3', 'Bruno Sandoval', 'Business Tax', 21, [14, 0], [15, 0], 'green'),
  event('4', 'Team Meeting', 'Staff Meeting', 21, [16, 0], [17, 0], 'purple'),
  event('5', 'Selma Shields', 'Bookkeeping', 22, [10, 0], [11, 0], 'amber'),
  event('6', 'Ravi Greenwood', 'Payroll Setup', 22, [13, 0], [14, 0], 'blue'),
  event('7', 'Mia Lattimore', 'Tax Planning', 22, [15, 30], [16, 30], 'red'),
  event('8', 'Shaw Bayliss', 'Client Review', 23, [9, 30], [10, 30], 'green'),
  event('9', 'Jonah Yates', 'New Client Intake', 23, [12, 0], [13, 0], 'purple'),
  event('10', 'Kendra Gill', 'Business Formation', 24, [11, 0], [12, 0], 'blue'),
  event('11', 'Amber Kessler', 'Consultation', 24, [14, 30], [15, 30], 'amber'),
  event('12', 'Jack Banfield', 'Tax Preparation', 25, [10, 0], [11, 0], 'red'),
  event('13', 'Clara Voss', 'Bookkeeping Review', 25, [13, 0], [14, 0], 'green'),
  event('14', 'Client Workshop', 'Small Business Taxes', 26, [9, 0], [11, 0], 'purple'),
];

function Calendar(props: CalendarGridProps) {
  const [date, setDate] = useState(props.date);
  const shift = (n: number) =>
    setDate((d) =>
      props.view === 'week'
        ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7 * n)
        : new Date(d.getFullYear(), d.getMonth() + n, 1),
    );
  return <CalendarGrid {...props} date={date} onPrev={() => shift(-1)} onNext={() => shift(1)} />;
}

/** Appointments' week view. */
export const Default: Story = {
  args: { view: 'week', date: today, today, events },
  render: (args) => (
    <div className="max-w-6xl">
      <Calendar {...args} />
    </div>
  ),
};

/** The small month beside it, and the month view. */
export const Month: Story = {
  args: { view: 'month', date: today, today, events, selected: at(23, 0) },
  render: (args) => (
    <div className="flex max-w-6xl gap-6">
      <div className="w-72 shrink-0 rounded-xl border border-border bg-surface p-4">
        <Calendar view="mini" date={today} today={today} />
      </div>
      <div className="min-w-0 flex-1">
        <Calendar {...args} />
      </div>
    </div>
  ),
};

/** No appointments: the empty grid, nothing invented. */
export const Empty: Story = {
  args: { view: 'week', date: today, today, events: [] },
  render: (args) => (
    <div className="max-w-6xl">
      <Calendar {...args} />
    </div>
  ),
};

export const LongText: Story = {
  args: {
    view: 'week',
    date: today,
    today,
    events: [
      event(
        'a',
        'Alexandria Montgomery-Whitfield and family',
        'Annual tax preparation and planning review',
        21,
        [9, 0],
        [10, 30],
        'blue',
      ),
      event(
        'b',
        'Overlapping consultation',
        'Second appointment at the same time',
        21,
        [9, 30],
        [10, 0],
        'amber',
      ),
    ],
  },
  render: (args) => (
    <div className="max-w-6xl">
      <Calendar {...args} />
    </div>
  ),
};
