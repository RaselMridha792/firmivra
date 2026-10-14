import type { ClientListItem, DocumentCategory, FirmDocument } from '@firmivra/types';
import { FilterBar, SearchField, Select } from '@firmivra/ui';

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
    <div data-testid="documents-filters">
      <FilterBar>
        <Select
          label="Client"
          hideLabel
          data-testid="filter-client"
          className="w-44"
          value={clientId}
          onChange={(event) => onClientChange(event.target.value)}
          options={[
            { value: '', label: 'All Clients' },
            ...clients.map((c) => ({ value: c.id, label: c.displayName })),
          ]}
        />
        <Select
          label="Document type"
          hideLabel
          data-testid="filter-type"
          className="w-56"
          value={categoryId}
          onChange={(event) => onCategoryChange(event.target.value)}
          options={[
            { value: '', label: 'All Document Types' },
            ...categories.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <Select
          label="Status"
          hideLabel
          data-testid="filter-status"
          className="w-40"
          value={status}
          onChange={(event) =>
            onStatusChange(event.target.value as '' | FirmDocument['scanStatus'])
          }
          options={STATUS_OPTIONS}
        />
        <SearchField
          label="Search documents"
          placeholder="Search documents..."
          maxLength={100}
          value={search}
          data-testid="filter-search"
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </FilterBar>
    </div>
  );
}
