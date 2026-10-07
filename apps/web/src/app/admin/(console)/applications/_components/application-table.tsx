import Link from 'next/link';
import { Button } from '@firmivra/ui';
import type { FirmApplication } from './application-data';
import { formatDate, StatusPill } from './application-ui';

const pageSize = 5;

export function ApplicationTable({
  applications,
  page,
  onPage,
}: {
  applications: FirmApplication[];
  page: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(applications.length / pageSize));
  const current = Math.min(page, pages);
  const rows = applications.slice((current - 1) * pageSize, current * pageSize);
  const first = applications.length ? (current - 1) * pageSize + 1 : 0;
  const last = Math.min(current * pageSize, applications.length);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[950px] text-left text-sm">
          <thead className="bg-canvas text-text">
            <tr>
              {[
                'Business name',
                'Business type',
                'Owner / contact',
                'Email',
                'Services',
                'Requested plan',
                'Submitted',
                'Status',
                'Action',
              ].map((label) => (
                <th key={label} scope="col" className="px-3 py-4 font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((application) => (
              <tr key={application.id} className="align-top hover:bg-canvas/70">
                <th scope="row" className="max-w-44 px-3 py-4 font-semibold text-text">
                  {application.businessName}
                </th>
                <td className="px-3 py-4 text-muted">{application.businessType}</td>
                <td className="px-3 py-4 text-text">
                  {application.ownerName}
                  <span className="block text-muted">{application.phone}</span>
                </td>
                <td className="px-3 py-4 text-text">{application.email}</td>
                <td className="max-w-48 px-3 py-4 text-text">{application.services.join(', ')}</td>
                <td className="px-3 py-4 text-text">{application.requestedPlan}</td>
                <td className="whitespace-nowrap px-3 py-4 text-muted">
                  {formatDate(application.submittedAt)}
                </td>
                <td className="px-3 py-4">
                  <StatusPill status={application.status} />
                </td>
                <td className="px-3 py-4">
                  <Link
                    className="inline-flex whitespace-nowrap rounded-control bg-brand-700 px-4 py-2 font-medium text-white hover:bg-brand-600"
                    href={`/applications/${application.id}`}
                  >
                    Open application
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {applications.length === 0 ? (
        <p role="status" className="px-5 py-12 text-center text-sm text-muted">
          No applications match these filters.
        </p>
      ) : null}
      <footer className="flex flex-col gap-3 border-t border-border p-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted">
          Showing {first}–{last} of {applications.length} applications
        </p>
        <nav aria-label="Application pages" className="flex items-center gap-2">
          <Button variant="secondary" disabled={current <= 1} onClick={() => onPage(current - 1)}>
            Previous
          </Button>
          <span aria-current="page" className="min-w-8 text-center text-sm font-medium">
            {current} / {pages}
          </span>
          <Button
            variant="secondary"
            disabled={current >= pages}
            onClick={() => onPage(current + 1)}
          >
            Next
          </Button>
        </nav>
      </footer>
    </>
  );
}
