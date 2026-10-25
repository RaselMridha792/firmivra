'use client';

import type { DocumentFolder } from '@firmivra/types';
import { Button, Skeleton } from '@firmivra/ui';
import {
  Archive,
  CaretDown,
  CaretRight,
  Folder,
  FolderOpen,
  HouseLine,
  LockSimple,
  MagnifyingGlass,
  Plus,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { RowMenu } from '../../../team/_components/row-menu';
import { buildTree, COLORS, filterTree, type FolderNode } from './folder-parts';

export interface TreeActions {
  select: (folder: DocumentFolder) => void;
  addFolder: () => void;
  addSubfolder: (parent: DocumentFolder) => void;
  reorder: (folder: DocumentFolder) => void;
  remove: (folder: DocumentFolder) => void;
}

/** Frame 6's left column: the firm's folders as a tree, searchable, each one opening its editor. */
export function FolderTree({
  folders,
  state,
  selectedId,
  canEdit,
  on,
}: {
  folders: DocumentFolder[];
  state: 'loading' | 'error' | 'ready';
  selectedId: string | null;
  canEdit: boolean;
  on: TreeActions;
}) {
  const [search, setSearch] = useState('');
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const nodes = filterTree(buildTree(folders), search);
  const searching = search.trim() !== '';

  const row = (node: FolderNode) => {
    const f = node.folder;
    const open = searching || !closed.has(f.id);
    const chosen = f.id === selectedId;
    const top = node.depth === 1;
    const Glyph = top ? FolderOpen : Folder;
    return (
      <li key={f.id}>
        <div
          className={`group flex items-center gap-1 rounded-control pr-1 ${chosen ? 'bg-folder-surface' : 'hover:bg-canvas'}`}
          style={{ paddingLeft: `${(node.depth - 1) * 1.25}rem` }}
        >
          {node.children.length ? (
            <button
              type="button"
              aria-label={`${open ? 'Collapse' : 'Expand'} ${f.name}`}
              aria-expanded={open}
              onClick={() =>
                setClosed((s) => {
                  const next = new Set(s);
                  if (next.has(f.id)) next.delete(f.id);
                  else next.add(f.id);
                  return next;
                })
              }
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-control text-heading hover:bg-surface"
            >
              {open ? (
                <CaretDown aria-hidden weight="bold" className="size-4" />
              ) : (
                <CaretRight aria-hidden weight="bold" className="size-4" />
              )}
            </button>
          ) : (
            <span className="size-7 shrink-0" aria-hidden />
          )}
          <button
            type="button"
            data-testid="tree-folder"
            aria-current={chosen ? 'true' : undefined}
            onClick={() => on.select(f)}
            className={`flex min-h-10 min-w-0 flex-1 items-center gap-2 text-left text-sm ${chosen ? 'font-semibold text-heading' : 'text-text'}`}
          >
            <Glyph
              aria-hidden
              weight="fill"
              className={`size-5 shrink-0 ${COLORS[f.color].icon}`}
            />
            <span className="truncate">{f.name}</span>
            {top && f.scope === 'FIRM' ? (
              <LockSimple
                aria-label="Firm only"
                weight="fill"
                className="size-4 shrink-0 text-heading"
              />
            ) : null}
          </button>
          {canEdit && chosen ? (
            <RowMenu
              label={`Actions for ${f.name}`}
              items={[
                { label: 'Add Subfolder', onSelect: () => on.addSubfolder(f) },
                { label: 'Reorder', onSelect: () => on.reorder(f) },
                { label: 'Delete Folder', danger: true, onSelect: () => on.remove(f) },
              ]}
            />
          ) : null}
        </div>
        {open && node.children.length ? (
          <ul aria-label={`In ${f.name}`}>{node.children.map(row)}</ul>
        ) : null}
      </li>
    );
  };

  return (
    <section
      aria-labelledby="folders-title"
      data-testid="folder-tree"
      className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-surface p-4"
    >
      <div>
        <h2 id="folders-title" className="font-display text-xl font-bold text-heading">
          Folders &amp; Categories
        </h2>
        <p className="text-sm text-muted">Organize how documents are stored and viewed.</p>
      </div>
      <div className="flex gap-2">
        <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-control border border-border bg-surface px-3 text-sm">
          <MagnifyingGlass aria-hidden weight="bold" className="size-4 shrink-0 text-muted" />
          <span className="sr-only">Search folders</span>
          <input
            type="search"
            maxLength={80}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search folders…"
            className="min-h-0 w-full min-w-0 bg-transparent text-text outline-none"
          />
        </label>
        {canEdit ? (
          <Button variant="outline" onClick={on.addFolder}>
            <Plus aria-hidden weight="bold" className="size-4" />
            Add Folder
          </Button>
        ) : null}
      </div>
      <Link
        href="/documents"
        className="flex min-h-10 items-center gap-2 rounded-control px-2 text-sm text-text hover:bg-canvas"
      >
        <HouseLine aria-hidden weight="fill" className="size-5 text-heading" />
        All Documents
      </Link>
      {state === 'loading' ? (
        <Skeleton className="h-64" />
      ) : state === 'error' ? (
        <p className="px-2 py-4 text-sm text-muted">Folders could not be loaded right now.</p>
      ) : nodes.length === 0 ? (
        <p className="px-2 py-4 text-sm text-muted">
          {searching ? 'No folders match your search.' : 'No folders yet. Add the first one.'}
        </p>
      ) : (
        <ul aria-label="Folders" className="flex flex-col gap-0.5">
          {nodes.map(row)}
        </ul>
      )}
      <span
        data-testid="folder-archived"
        aria-disabled="true"
        title="Archived documents are not listed in the library yet."
        className="flex min-h-10 cursor-not-allowed items-center gap-2 border-t border-divider px-2 pt-2 text-sm text-muted"
      >
        <Archive aria-hidden weight="fill" className="size-5" />
        Archived Documents
      </span>
    </section>
  );
}
