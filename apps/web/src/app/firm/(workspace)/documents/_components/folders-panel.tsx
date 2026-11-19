import type { DocumentCategory } from '@firmivra/types';
import { Card } from '@firmivra/ui';
import { Folder, FolderOpen, Plus, Trash } from '@phosphor-icons/react';
import Link from 'next/link';

export interface FolderFilter {
  id: string;
  label: string;
}
export const ALL_DOCUMENTS: FolderFilter = { id: '', label: 'All Documents' };

/** Which documents the page lists: the live ones, the archived ones, or the Trash. */
export type DocumentsView = 'active' | 'archived' | 'trash';

/**
 * Bookkeeping Review 2 (plain-language Documents messages): what Archived and Trash really are.
 * A document is archived (Archive) or moved to Trash (Move to Trash, with the Delete permission)
 * from its menu or its page; both keep the file, and either can be restored. Nothing in the Trash
 * is ever deleted for good from here.
 */
export const VIEW_HELP: Record<Exclude<DocumentsView, 'active'>, string> = {
  archived:
    'Documents archived from their menu or page. They leave the lists but are kept; Restore brings one back.',
  trash:
    'Documents moved to Trash. They are kept and never deleted for good from here; Restore from Trash brings one back.',
};

/**
 * The design's folder names (Firm Documents, Tax Returns, Licenses & Credentials...) are its own
 * examples; the docx calls them "configurable", not fixed. This lists the firm's real categories
 * (api.documents.categories()) instead of copying those example names. Archived and Trash open
 * the chosen client's archived and trashed documents, with their counts (Bookkeeping Review 2).
 */
export function FoldersPanel({
  categories,
  selected,
  onSelect,
  view,
  onView,
  counts,
}: {
  categories: DocumentCategory[];
  selected: string;
  onSelect: (categoryId: string) => void;
  view: DocumentsView;
  onView: (view: DocumentsView) => void;
  /** The chosen client's archived and trashed documents; null without a client. */
  counts: { archived: number | undefined; trash: number | undefined } | null;
}) {
  const rows: FolderFilter[] = [
    ALL_DOCUMENTS,
    ...categories.map((c) => ({ id: c.id, label: c.name })),
  ];
  return (
    <Card className="flex flex-col gap-1 p-4" data-testid="folders-panel">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-lg font-bold text-heading">Folders</h2>
        {/* Add Folder opens Frame 6 (Document Settings). */}
        <Link
          href="/documents/settings"
          className="inline-flex size-9 items-center justify-center rounded-control border border-border text-text hover:bg-canvas"
          aria-label="Add folder"
          data-testid="add-folder"
        >
          <Plus weight="bold" className="size-4" aria-hidden="true" />
        </Link>
      </div>
      {rows.map((row) => {
        const active = view === 'active' && row.id === selected;
        return (
          <button
            key={row.id}
            type="button"
            onClick={() => {
              onView('active');
              onSelect(row.id);
            }}
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
      {(['archived', 'trash'] as const).map((v) => {
        const active = view === v;
        const count = counts?.[v];
        const Glyph = v === 'archived' ? FolderOpen : Trash;
        return (
          <button
            key={v}
            type="button"
            disabled={!counts}
            onClick={() => onView(active ? 'active' : v)}
            aria-pressed={active}
            data-testid={v === 'archived' ? 'folder-archived' : 'folder-trash'}
            title={
              counts ? VIEW_HELP[v] : 'Select a client to see their archived and trashed documents.'
            }
            className={`flex items-center justify-between gap-2 rounded-control px-2 py-2 text-left text-sm disabled:cursor-not-allowed disabled:text-muted ${
              active
                ? 'border-l-4 border-action bg-folder-surface font-semibold text-action'
                : 'border-l-4 border-transparent text-text hover:bg-canvas'
            }`}
          >
            <span className="flex items-center gap-2">
              <Glyph
                weight={v === 'archived' ? 'fill' : 'regular'}
                className="size-5 text-muted"
                aria-hidden="true"
              />
              {v === 'archived' ? 'Archived' : 'Trash'}
            </span>
            <span>{count === undefined ? '—' : count}</span>
          </button>
        );
      })}
    </Card>
  );
}
