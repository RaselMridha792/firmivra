import type { ClientListItem, DocumentCategory, FirmDocument } from '@firmivra/types';
import { MagnifyingGlass } from '@phosphor-icons/react';
import type { SelectHTMLAttributes } from 'react';

const STATUS_OPTIONS: { value: '' | FirmDocument['scanStatus']; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'CLEAN', label: 'Verified' },
  { value: 'PENDING', label: 'Checking' },
  { value: 'INFECTED', label: 'Blocked' },
  { value: 'FAILED', label: 'Scan failed' },
];

/**
 * The design's filter row has no visible labels, but @firmivra/ui's Select always renders one
 * (packages/ui/src/fields.tsx) with no prop to hide it — same for Input. Reported to Rasel rather
 * than editing packages/ui: both are missing a `hideLabel` (visually-hidden) prop. Until then, a
 * local compact variant with the same classes as Select (copied, since they aren't exported) and
 * an aria-label instead.
 */
function CompactSelect({
  ariaLabel,
  options,
  className = '',
  ...props
}: { ariaLabel: string; options: { value: string; label: string }[] } & Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'aria-label'
>) {
  return (
    <div className={`relative min-w-0 ${className}`}>
      <select
        aria-label={ariaLabel}
        className="min-w-0 w-full max-w-full appearance-none rounded-control border border-border bg-surface py-2 pl-3 pr-9 text-sm text-text focus:outline-2 focus:outline-accent-500"
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}

export function DocumentsFiltersBar({
  clients,
  clientId,
  onClientChange,
  categories,
  categoryId,
  onCategoryChange,
  status,
  onStatusChange,
  search,
  onSearchChange,
}: {
  clients: ClientListItem[];
  clientId: string;
  onClientChange: (value: string) => void;
  categories: DocumentCategory[];
  categoryId: string;
  onCategoryChange: (value: string) => void;
  status: '' | FirmDocument['scanStatus'];
  onStatusChange: (value: '' | FirmDocument['scanStatus']) => void;
  search: string;
  onSearchChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row" data-testid="documents-filters">
      <CompactSelect
        ariaLabel="Client"
        data-testid="filter-client"
        className="sm:flex-[1.1]"
        value={clientId}
        onChange={(event) => onClientChange(event.target.value)}
        options={[
          { value: '', label: 'All Clients' },
          ...clients.map((c) => ({ value: c.id, label: c.displayName })),
        ]}
      />
      <CompactSelect
        ariaLabel="Document type"
        data-testid="filter-type"
        className="sm:flex-[1.3]"
        value={categoryId}
        onChange={(event) => onCategoryChange(event.target.value)}
        options={[
          { value: '', label: 'All Document Types' },
          ...categories.map((c) => ({ value: c.id, label: c.name })),
        ]}
      />
      <CompactSelect
        ariaLabel="Status"
        data-testid="filter-status"
        className="sm:flex-1"
        value={status}
        onChange={(event) => onStatusChange(event.target.value as '' | FirmDocument['scanStatus'])}
        options={STATUS_OPTIONS}
      />
      <div className="relative min-w-0 sm:flex-[1.3]">
        <MagnifyingGlass
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted"
        />
        <input
          type="search"
          maxLength={100}
          value={search}
          placeholder="Search documents..."
          aria-label="Search documents"
          data-testid="filter-search"
          onChange={(event) => onSearchChange(event.target.value)}
          className="w-full rounded-control border border-border bg-surface py-2 pr-3 pl-9 text-sm text-text placeholder:text-muted focus:outline-2 focus:outline-accent-500"
        />
      </div>
    </div>
  );
}
