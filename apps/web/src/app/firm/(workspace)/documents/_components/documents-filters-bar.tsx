import type { ClientListItem, DocumentCategory, FirmDocument } from '@firmivra/types';
import { Select } from '@firmivra/ui';
import { MagnifyingGlass } from '@phosphor-icons/react';

const STATUS_OPTIONS: { value: '' | FirmDocument['scanStatus']; label: string }[] = [
  { value: '', label: 'All Statuses' },
  { value: 'CLEAN', label: 'Verified' },
  { value: 'PENDING', label: 'Checking' },
  { value: 'INFECTED', label: 'Blocked' },
  { value: 'FAILED', label: 'Scan failed' },
];

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
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap" data-testid="documents-filters">
      <div className="min-w-0 sm:w-56">
        <Select
          label="Client"
          data-testid="filter-client"
          value={clientId}
          onChange={(event) => onClientChange(event.target.value)}
          options={[
            { value: '', label: 'All Clients' },
            ...clients.map((c) => ({ value: c.id, label: c.displayName })),
          ]}
        />
      </div>
      <div className="min-w-0 sm:w-56">
        <Select
          label="Document type"
          data-testid="filter-type"
          value={categoryId}
          onChange={(event) => onCategoryChange(event.target.value)}
          options={[
            { value: '', label: 'All Document Types' },
            ...categories.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
      </div>
      <div className="min-w-0 sm:w-48">
        <Select
          label="Status"
          data-testid="filter-status"
          value={status}
          onChange={(event) =>
            onStatusChange(event.target.value as '' | FirmDocument['scanStatus'])
          }
          options={STATUS_OPTIONS}
        />
      </div>
      <div className="min-w-0 flex-1 sm:min-w-56">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-text">Search documents</span>
          <span className="relative block">
            <MagnifyingGlass
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted"
            />
            <input
              type="search"
              maxLength={100}
              value={search}
              placeholder="Search documents..."
              data-testid="filter-search"
              onChange={(event) => onSearchChange(event.target.value)}
              className="w-full rounded-control border border-border bg-surface py-2 pr-3 pl-11 text-base text-text placeholder:text-muted focus:outline-2 focus:outline-accent-500"
            />
          </span>
        </label>
      </div>
    </div>
  );
}
