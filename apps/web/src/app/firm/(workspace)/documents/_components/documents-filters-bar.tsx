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
        {/*
          Select's own classes include w-full, which wins the cascade over a width class passed
          through its className (Tailwind orders utilities internally, not by class-attribute
          order — the same kind of conflict as SearchField's old min-w floor). Select's own doc
          comment says to size a parent instead, so each one sits in a flex-1 wrapper with a
          min-w floor: narrow at 1280px, growing to share the row's extra space at 1440px.
        */}
        <div className="min-w-24 flex-1">
          <Select
            label="Client"
            hideLabel
            data-testid="filter-client"
            value={clientId}
            onChange={(event) => onClientChange(event.target.value)}
            options={[
              { value: '', label: 'All Clients' },
              ...clients.map((c) => ({ value: c.id, label: c.displayName })),
            ]}
          />
        </div>
        <div className="min-w-28 flex-1">
          <Select
            label="Document type"
            hideLabel
            data-testid="filter-type"
            value={categoryId}
            onChange={(event) => onCategoryChange(event.target.value)}
            options={[
              { value: '', label: 'All Document Types' },
              ...categories.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </div>
        <div className="min-w-20 flex-1">
          <Select
            label="Status"
            hideLabel
            data-testid="filter-status"
            value={status}
            onChange={(event) =>
              onStatusChange(event.target.value as '' | FirmDocument['scanStatus'])
            }
            options={STATUS_OPTIONS}
          />
        </div>
        <SearchField
          label="Search documents"
          placeholder="Search documents..."
          maxLength={100}
          value={search}
          data-testid="filter-search"
          minWidth="3.5rem"
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </FilterBar>
    </div>
  );
}
