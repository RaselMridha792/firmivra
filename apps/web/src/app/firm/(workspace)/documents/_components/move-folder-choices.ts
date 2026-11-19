import type { DocumentFolder } from '@firmivra/types';

type Scope = DocumentFolder['scope'];

/** One scope's folders as options, children indented under their parent (the API's flat list). */
function treeOptions(folders: DocumentFolder[], scope: Scope, suffix: string) {
  const mine = folders.filter((f) => f.scope === scope);
  const roots = mine.filter((f) => !f.parentId || !mine.some((p) => p.id === f.parentId));
  const byOrder = (a: DocumentFolder, b: DocumentFolder) => a.sortOrder - b.sortOrder;
  return roots.sort(byOrder).flatMap((root) => [
    { value: root.id, label: `${root.name}${suffix}` },
    ...mine
      .filter((f) => f.parentId === root.id)
      .sort(byOrder)
      .map((child) => ({ value: child.id, label: `\u2003${child.name}${suffix}` })),
  ]);
}

/**
 * The folders Move offers a document (Clients, R61's sweep): any folder it could be uploaded into.
 * A file the client can see: client folders only (a firm folder never holds one; the API refuses
 * FOLDER_SCOPE). An internal file: the client folders Upload offers, and the firm folders, as the
 * API takes either; it stays internal in a client folder.
 */
export function moveFolderChoices(folders: DocumentFolder[], direction: string) {
  if (direction !== 'INTERNAL') return treeOptions(folders, 'CLIENT', '');
  return [
    ...treeOptions(folders, 'CLIENT', ' (Client)'),
    ...treeOptions(folders, 'FIRM', ' (Firm)'),
  ];
}

/** The line under Move's folder choice. */
export function moveFolderHint(direction: string) {
  return direction === 'INTERNAL'
    ? 'Client or firm folders. The file stays internal in either: the client never sees it.'
    : 'Client folders only: a firm folder never holds a file the client can see.';
}
