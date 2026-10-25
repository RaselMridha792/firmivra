import type {
  DocumentFolder,
  FolderClientAccess,
  FolderColor,
  UpdateDocumentFolderRequest,
} from '@firmivra/types';

/** The API's limit: at most 5 folder levels (400 FOLDER_TOO_DEEP). */
export const MAX_DEPTH = 5;

/** Each folder colour as `packages/ui` tokens: the swatch and the folder icon. */
export const COLORS: Record<FolderColor, { label: string; swatch: string; icon: string }> = {
  BLUE: { label: 'Blue', swatch: 'bg-info', icon: 'text-info' },
  GREEN: { label: 'Green', swatch: 'bg-success', icon: 'text-success' },
  YELLOW: { label: 'Yellow', swatch: 'bg-gold', icon: 'text-gold' },
  ORANGE: { label: 'Orange', swatch: 'bg-orange', icon: 'text-orange' },
  PINK: { label: 'Pink', swatch: 'bg-portal-icon-magenta', icon: 'text-portal-icon-magenta' },
  PURPLE: { label: 'Purple', swatch: 'bg-purple', icon: 'text-purple' },
  GRAY: { label: 'Gray', swatch: 'bg-muted', icon: 'text-muted' },
};

export const ACCESS_OPTIONS: { value: FolderClientAccess; label: string; note: string }[] = [
  { value: 'NONE', label: 'Firm only', note: 'New documents stay hidden from the client.' },
  {
    value: 'VIEW',
    label: 'Client (View)',
    note: 'The client can see their own new documents here.',
  },
  {
    value: 'VIEW_UPLOAD',
    label: 'Client (View & Upload)',
    note: 'The client can see their own new documents here and upload to this folder.',
  },
];

export interface FolderNode {
  folder: DocumentFolder;
  depth: number;
  children: FolderNode[];
}

const byOrder = (a: DocumentFolder, b: DocumentFolder) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

/** The flat list as a tree (roots first, each level in its order). */
export function buildTree(folders: readonly DocumentFolder[]): FolderNode[] {
  const ids = new Set(folders.map((f) => f.id));
  const grow = (parentId: string | null, depth: number): FolderNode[] =>
    folders
      .filter((f) =>
        parentId === null ? !f.parentId || !ids.has(f.parentId) : f.parentId === parentId,
      )
      .sort(byOrder)
      .map((folder) => ({ folder, depth, children: grow(folder.id, depth + 1) }));
  return grow(null, 1);
}

/** Every folder in tree order, with its depth (for selects and the access table). */
export function flatten(nodes: readonly FolderNode[]): FolderNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

/** The nodes whose name matches, with the folders above them so the path stays visible. */
export function filterTree(nodes: readonly FolderNode[], term: string): FolderNode[] {
  const t = term.trim().toLowerCase();
  if (!t) return [...nodes];
  return nodes.flatMap((n) => {
    const children = filterTree(n.children, t);
    return n.folder.name.toLowerCase().includes(t) || children.length ? [{ ...n, children }] : [];
  });
}

export function siblingsOf(folders: readonly DocumentFolder[], parentId: string | null) {
  return folders.filter((f) => (f.parentId ?? null) === parentId).sort(byOrder);
}

function levels(folders: readonly DocumentFolder[], id: string): number {
  const kids = folders.filter((f) => f.parentId === id);
  return 1 + Math.max(0, ...kids.map((k) => levels(folders, k.id)));
}

function depthOf(folders: readonly DocumentFolder[], id: string | null): number {
  let depth = 0;
  for (let at = id; at; at = folders.find((f) => f.id === at)?.parentId ?? null) depth += 1;
  return depth;
}

/**
 * Where a folder may go (or a new one be made): the same scope, never inside itself, and no
 * deeper than five levels with everything under it.
 */
export function parentChoices(
  folders: readonly DocumentFolder[],
  scope: DocumentFolder['scope'],
  moving?: DocumentFolder,
): DocumentFolder[] {
  const blocked = new Set<string>();
  if (moving) {
    const stack = [moving.id];
    while (stack.length) {
      const id = stack.pop()!;
      blocked.add(id);
      stack.push(...folders.filter((f) => f.parentId === id).map((f) => f.id));
    }
  }
  const height = moving ? levels(folders, moving.id) : 1;
  return flatten(buildTree(folders))
    .map((n) => n.folder)
    .filter((f) => f.scope === scope && !blocked.has(f.id))
    .filter((f) => depthOf(folders, f.id) + height <= MAX_DEPTH);
}

export interface FolderDraft {
  name: string;
  description: string;
  parentId: string | null;
  scope: DocumentFolder['scope'];
  color: FolderColor;
  requireExpiryDate: boolean;
  remindBeforeExpiry: boolean;
  allowClientUploads: boolean;
  notifyStaffOnUpload: boolean;
  defaultClientAccess: FolderClientAccess;
}

export function draftOf(f: DocumentFolder): FolderDraft {
  return {
    name: f.name,
    description: f.description ?? '',
    parentId: f.parentId,
    scope: f.scope,
    color: f.color,
    requireExpiryDate: f.requireExpiryDate,
    remindBeforeExpiry: f.remindBeforeExpiry,
    allowClientUploads: f.allowClientUploads,
    notifyStaffOnUpload: f.notifyStaffOnUpload,
    defaultClientAccess: f.defaultClientAccess,
  };
}

/** A new folder starts from its parent's settings (a firm folder is never the client's). */
export function newDraft(
  parent: DocumentFolder | null,
  scope: DocumentFolder['scope'],
): FolderDraft {
  const s = parent?.scope ?? scope;
  return {
    name: '',
    description: '',
    parentId: parent?.id ?? null,
    scope: s,
    color: parent?.color ?? 'BLUE',
    requireExpiryDate: parent?.requireExpiryDate ?? false,
    remindBeforeExpiry: parent?.remindBeforeExpiry ?? false,
    allowClientUploads: s === 'CLIENT' && (parent?.allowClientUploads ?? true),
    notifyStaffOnUpload: parent?.notifyStaffOnUpload ?? true,
    defaultClientAccess: s === 'CLIENT' ? (parent?.defaultClientAccess ?? 'NONE') : 'NONE',
  };
}

/** Only what changed, for the PATCH (it refuses an empty body). */
export function folderChanges(
  f: DocumentFolder,
  d: FolderDraft,
): UpdateDocumentFolderRequest | null {
  const before = draftOf(f);
  const out: Record<string, unknown> = {};
  if (d.name.trim() !== before.name) out['name'] = d.name.trim();
  if (d.description.trim() !== before.description)
    out['description'] = d.description.trim() || null;
  for (const key of [
    'parentId',
    'color',
    'requireExpiryDate',
    'remindBeforeExpiry',
    'allowClientUploads',
    'notifyStaffOnUpload',
    'defaultClientAccess',
  ] as const)
    if (d[key] !== before[key]) out[key] = d[key];
  return Object.keys(out).length ? (out as UpdateDocumentFolderRequest) : null;
}

/** Moves one id up or down among its siblings; the API takes the whole new order. */
export function moved(ids: readonly string[], id: string, by: -1 | 1): string[] {
  const at = ids.indexOf(id);
  const to = at + by;
  if (at < 0 || to < 0 || to >= ids.length) return [...ids];
  const next = [...ids];
  [next[at], next[to]] = [next[to]!, next[at]!];
  return next;
}
