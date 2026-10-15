import type { DocumentCategory } from '@firmivra/types';
import { Card } from '@firmivra/ui';
import { Folder, FolderOpen, Plus, Trash } from '@phosphor-icons/react';
import Link from 'next/link';
import { moduleHref } from '../../../../../lib/firm-modules';

export interface FolderFilter {
  id: string;
  label: string;
}
export const ALL_DOCUMENTS: FolderFilter = { id: '', label: 'All Documents' };

/**
 * The design's folder names (Firm Documents, Tax Returns, Licenses & Credentials...) are its own
 * examples; the docx calls them "configurable", not fixed. This lists the firm's real categories
 * (api.documents.categories()) instead of copying those example names. Archived and Trash have no
 * backing concept in the data model (documents are kept, never archived or trashed: see the
 * Document model's comment in packages/db/prisma/schema.prisma) — shown, inert, 0 (R34 PR).
 */
export function FoldersPanel({
  categories,
  selected,
  onSelect,
}: {
  categories: DocumentCategory[];
  selected: string;
  onSelect: (categoryId: string) => void;
}) {
  const rows: FolderFilter[] = [
    ALL_DOCUMENTS,
    ...categories.map((c) => ({ id: c.id, label: c.name })),
  ];
  return (
    <Card className="flex flex-col gap-1 p-4" data-testid="folders-panel">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-bold text-heading">Folders</h2>
        {/* Add Folder opens Frame 6 (Document Settings), not built yet. */}
        <Link
          href={moduleHref('document-requests')}
          className="inline-flex size-9 items-center justify-center rounded-control border border-border text-text hover:bg-canvas"
          aria-label="Add folder"
          data-testid="add-folder"
        >
          <Plus weight="bold" className="size-4" aria-hidden="true" />
        </Link>
      </div>
      {rows.map((row) => {
        const active = row.id === selected;
        return (
          <button
            key={row.id}
            type="button"
            onClick={() => onSelect(row.id)}
            data-testid="folder-row"
            aria-pressed={active}
            className={`flex items-center justify-between gap-2 rounded-control px-2 py-2 text-left text-sm ${
              active
                ? 'border-l-4 border-action bg-folder-surface font-semibold text-action'
                : 'border-l-4 border-transparent text-text hover:bg-canvas'
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              {active ? (
                <Folder weight="fill" className="size-5 shrink-0 text-action" aria-hidden="true" />
              ) : (
                <Folder
                  weight="fill"
                  className="size-5 shrink-0 text-folder-icon"
                  aria-hidden="true"
                />
              )}
              <span className="truncate">{row.label}</span>
            </span>
          </button>
        );
      })}
      <div className="my-2 h-px bg-border" />
      <button
        type="button"
        disabled
        data-testid="folder-archived"
        className="flex items-center justify-between gap-2 rounded-control px-2 py-2 text-left text-sm text-muted"
        title="Documents are never archived yet: there is no archive action in the API."
      >
        <span className="flex items-center gap-2">
          <FolderOpen weight="fill" className="size-5 text-muted" aria-hidden="true" />
          Archived
        </span>
        <span>&mdash;</span>
      </button>
      <button
        type="button"
        disabled
        data-testid="folder-trash"
        className="flex items-center justify-between gap-2 rounded-control px-2 py-2 text-left text-sm text-muted"
        title="Documents are never deleted from this list yet: there is no delete action in the API."
      >
        <span className="flex items-center gap-2">
          <Trash weight="regular" className="size-5 text-muted" aria-hidden="true" />
          Trash
        </span>
        <span>0</span>
      </button>
    </Card>
  );
}
