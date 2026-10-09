'use client';

import type { FirmApplicationEvent, FirmApplicationRecord } from '@firmivra/types';
import { Card } from '@firmivra/ui';
import { CircleCheck, Clock3, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { dateParts } from './application-ui';

/** A label and its value; a missing value shows a dash. */
export type Field = readonly [label: string, value: ReactNode];

/** A card heading as in the mockups: a blue line icon and a serif title. */
export function CardHeading({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-3 font-display text-xl font-bold text-heading">
      <Icon aria-hidden className="size-6 shrink-0 text-link" />
      {children}
    </h2>
  );
}

/** Label and value rows on a tinted inset table, the label column about 40% wide. */
export function FieldCard({
  icon,
  title,
  fields,
}: {
  icon: LucideIcon;
  title: string;
  fields: readonly Field[];
}) {
  return (
    <Card className="!p-3">
      <CardHeading icon={icon}>{title}</CardHeading>
      <dl className="mt-4 overflow-hidden rounded-control bg-canvas text-sm">
        {fields.map(([label, value]) => (
          <div key={label} className="grid grid-cols-5 border-b border-surface last:border-b-0">
            <dt className="col-span-2 px-2 py-1.5 text-muted">{label}</dt>
            <dd className="col-span-3 border-l border-surface px-2 py-1.5 break-words text-text">
              {typeof value === 'string' ? value.trim() || '—' : (value ?? '—')}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** '+14045550101' as '(404) 555-0101'; anything else as it was typed. */
export function formatPhone(value: string | null | undefined) {
  const us = value?.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return us ? `(${us[1]}) ${us[2]}-${us[3]}` : value;
}

/** The documents table; "No documents uploaded." in its body when there are none. */
export function DocumentsTable({ documents }: { documents: FirmApplicationRecord['documents'] }) {
  return (
    <div className="mt-4 overflow-hidden rounded-control border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-folder-surface text-text">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Document Name
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              File
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Uploaded
            </th>
          </tr>
        </thead>
        <tbody>
          {documents.length ? (
            documents.map((document) => (
              <tr key={document.id} className="border-t border-border">
                <td className="px-3 py-2">{document.name}</td>
                <td className="px-3 py-2 break-all">{document.fileName}</td>
                <td className="px-3 py-2 text-right">{dateParts(document.uploadedAt)[0]}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={3} className="px-3 py-4 text-center text-muted">
                No documents uploaded.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

const EVENT_TITLES: Record<FirmApplicationEvent['type'], string> = {
  SUBMITTED: 'Application Submitted',
  INFO_REQUESTED: 'Information Requested',
  APPROVED: 'Firm Approved',
  DECLINED: 'Application Declined',
  OWNER_INVITED: 'Owner Invited',
  FIRM_ACTIVATED: 'Firm Activated',
};

/** History as a timeline: a dot on a line, the date and time, then what happened. */
export function Timeline({ application }: { application: FirmApplicationRecord }) {
  if (!application.history.length)
    return <p className="mt-4 text-sm text-muted">No application history yet.</p>;
  // The API sends OWNER_INVITED and FIRM_ACTIVATED without a `by`, so each type has its own line.
  const describe = (event: FirmApplicationEvent) => {
    if (event.message) return event.message;
    if (event.type === 'SUBMITTED')
      return `Application received from ${application.contactName} (${application.contactEmail}).`;
    if (event.type === 'OWNER_INVITED')
      return `Activation link sent to ${application.primaryAdmin?.email ?? application.contactEmail}.`;
    if (event.type === 'FIRM_ACTIVATED') return 'The owner finished setup; the firm is active.';
    return event.by ? `Recorded by ${event.by.name}.` : 'Recorded by a Firmivra administrator.';
  };
  return (
    <ol className="mt-4 flex flex-col">
      {application.history.map((event) => {
        const [day, time] = dateParts(event.at);
        return (
          <li
            key={`${event.at}-${event.type}-${event.by?.userId ?? 'applicant'}-${event.message ?? ''}`}
            className="relative grid grid-cols-7 gap-3 pb-4 pl-6 text-sm before:absolute before:top-2 before:bottom-0 before:left-1.5 before:border-l-2 before:border-folder-border last:before:hidden"
          >
            <span aria-hidden className="absolute top-1 left-0 size-3 rounded-pill bg-link" />
            <time dateTime={event.at} className="col-span-2 whitespace-nowrap text-muted">
              {day}
              <span className="block">{time}</span>
            </time>
            <span className="col-span-5">
              <span className="block font-semibold text-text">{EVENT_TITLES[event.type]}</span>
              <span className="text-muted">{describe(event)}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** What an approved firm has switched on in the beta: on once the owner finished setup. */
export function ActiveFeatures({ active }: { active: boolean }) {
  return (
    <ul className="mt-4 flex flex-col gap-1 rounded-control bg-success-soft p-3 text-sm">
      {['Firm Workspace Access', 'Client Portal Access', 'Document Storage', 'Basic Settings'].map(
        (feature) => (
          <li key={feature} className="flex items-center gap-3 py-1">
            {active ? (
              <CircleCheck aria-hidden className="size-5 shrink-0 text-success" />
            ) : (
              <Clock3 aria-hidden className="size-5 shrink-0 text-muted" />
            )}
            <span className="flex-1 text-text">{feature}</span>
            <span
              className={`rounded-pill px-2 py-0.5 text-xs font-semibold ${active ? 'bg-surface text-success' : 'bg-surface text-warning'}`}
            >
              {active ? 'Active' : 'After setup'}
            </span>
          </li>
        ),
      )}
    </ul>
  );
}
