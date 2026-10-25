import type { DocumentFolder } from '@firmivra/types';
import { describe, expect, it } from 'vitest';
import {
  buildTree,
  draftOf,
  filterTree,
  flatten,
  folderChanges,
  moved,
  newDraft,
  parentChoices,
} from './folder-parts';

const id = (n: number) => `0199d2b0-6a00-7000-8000-${String(n).padStart(12, '0')}`;
const folder = (
  n: number,
  name: string,
  parent: number | null,
  scope: DocumentFolder['scope'] = 'CLIENT',
): DocumentFolder => ({
  id: id(n),
  name,
  description: null,
  parentId: parent === null ? null : id(parent),
  scope,
  color: 'BLUE',
  sortOrder: n,
  requireExpiryDate: false,
  remindBeforeExpiry: false,
  allowClientUploads: scope === 'CLIENT',
  notifyStaffOnUpload: true,
  defaultClientAccess: 'NONE',
  documentCount: 0,
  subfolderCount: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});
// Client Documents > Tax > 2025 > Q1 > Receipts (five levels), and Firm Internal > Marketing.
const folders = [
  folder(1, 'Client Documents', null),
  folder(2, 'Tax', 1),
  folder(3, '2025', 2),
  folder(4, 'Q1', 3),
  folder(5, 'Receipts', 4),
  folder(6, 'Bookkeeping', 1),
  folder(7, 'Firm Internal', null, 'FIRM'),
  folder(8, 'Marketing', 7, 'FIRM'),
];

describe('the tree', () => {
  it('nests by parent in order and keeps the path of a search match', () => {
    const tree = buildTree(folders);
    expect(tree.map((n) => n.folder.name)).toEqual(['Client Documents', 'Firm Internal']);
    expect(
      flatten(tree)
        .map((n) => [n.folder.name, n.depth])
        .slice(0, 3),
    ).toEqual([
      ['Client Documents', 1],
      ['Tax', 2],
      ['2025', 3],
    ]);
    const found = flatten(filterTree(tree, 'receipts')).map((n) => n.folder.name);
    expect(found).toEqual(['Client Documents', 'Tax', '2025', 'Q1', 'Receipts']);
  });
});

describe('parentChoices', () => {
  it('offers the same scope, never the folder itself or below it, within five levels', () => {
    const forTax = parentChoices(folders, 'CLIENT', folders[1]).map((f) => f.name);
    // Tax is four levels deep with what is under it, so it fits only directly in a top folder.
    expect(forTax).toEqual(['Client Documents']);
    const forNew = parentChoices(folders, 'CLIENT').map((f) => f.name);
    expect(forNew).not.toContain('Receipts');
    expect(forNew).not.toContain('Marketing');
    expect(parentChoices(folders, 'FIRM').map((f) => f.name)).toEqual([
      'Firm Internal',
      'Marketing',
    ]);
  });
});

describe('drafts', () => {
  it('sends only what changed, and nothing when nothing did', () => {
    const tax = folders[1]!;
    expect(folderChanges(tax, draftOf(tax))).toBeNull();
    expect(
      folderChanges(tax, {
        ...draftOf(tax),
        name: ' Tax Returns ',
        description: '',
        color: 'GREEN',
      }),
    ).toEqual({ name: 'Tax Returns', color: 'GREEN' });
  });

  it('starts a subfolder from its parent; a firm folder never opens to clients', () => {
    expect(newDraft(folders[0]!, 'FIRM')).toMatchObject({ scope: 'CLIENT', parentId: id(1) });
    expect(newDraft(null, 'FIRM')).toMatchObject({
      scope: 'FIRM',
      allowClientUploads: false,
      defaultClientAccess: 'NONE',
    });
  });
});

it('moves an id among its siblings', () => {
  expect(moved(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
  expect(moved(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
});
