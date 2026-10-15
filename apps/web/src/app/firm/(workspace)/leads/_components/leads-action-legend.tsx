import {
  CalendarBlank,
  ChartLine,
  ChatCircleDots,
  DotsThreeVertical,
  EnvelopeSimple,
  NotePencil,
  Phone,
  UserPlus,
} from '@phosphor-icons/react';

const actions = [
  { label: 'Call Lead', icon: Phone },
  { label: 'Send Email', icon: EnvelopeSimple },
  { label: 'Send SMS', icon: ChatCircleDots },
  { label: 'Schedule Appointment', icon: CalendarBlank },
  { label: 'Add/View Notes', icon: NotePencil },
  { label: 'Activity', icon: ChartLine },
  { label: 'Convert to Client', icon: UserPlus },
  { label: 'More Actions', detail: '(View, Edit, Assign, Tags, etc.)', icon: DotsThreeVertical },
];

/** The mockup's key for the compact per-lead actions shown in each table row. */
export function LeadsActionLegend() {
  return (
    <section
      aria-labelledby="lead-action-legend-title"
      className="rounded-card border border-border bg-table-head p-3"
    >
      <h2 id="lead-action-legend-title" className="font-semibold text-heading">
        Action Icons (Per Lead)
      </h2>
      <ul className="mt-3 grid grid-cols-2 divide-x divide-divider md:grid-cols-3 xl:grid-cols-8">
        {actions.map(({ label, detail, icon: Icon }) => (
          <li key={label} className="flex min-h-11 items-center gap-2 px-3 text-sm text-heading">
            <Icon aria-hidden weight="fill" className="size-5 shrink-0 text-action" />
            <span className="min-w-0">
              <span className="block">{label}</span>
              {detail ? <span className="block text-xs text-muted">{detail}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
