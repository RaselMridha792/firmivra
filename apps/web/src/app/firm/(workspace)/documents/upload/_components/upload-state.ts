import type { ClientListItem } from '@firmivra/types';

/** Frame 1's "Upload For": only a client has an upload route today (Lead and Firm: R56 Needs). */
export type UploadFor = 'CLIENT' | 'LEAD' | 'FIRM';

export type FileState = 'QUEUED' | 'UPLOADING' | 'DONE' | 'FAILED';

/** One file in the queue, with its own details (Document Details, docx Frame 1). */
export interface QueuedFile {
  key: string;
  file: File;
  /** The name it is saved under; its ending is added when left off. */
  name: string;
  categoryId: string;
  /** The client's engagement (the API's `serviceId`). */
  serviceId: string;
  /** `YYYY`, or empty for none. */
  taxYear: string;
  state: FileState;
  percent: number;
  error: string | null;
}

/** What the files share: destination, defaults, visibility, tags and reviewer. */
export interface SharedInfo {
  uploadFor: UploadFor;
  client: ClientListItem | null;
  categoryId: string;
  folderId: string;
  /** Document Name on Upload Files: the name of a single file. */
  name: string;
  description: string;
  shareWithClient: boolean;
  notifyClient: boolean;
  tags: string[];
  reviewerUserId: string;
}

export const EMPTY_INFO: SharedInfo = {
  uploadFor: 'CLIENT',
  client: null,
  categoryId: '',
  folderId: '',
  name: '',
  description: '',
  // Internal until the firm shares it (docx C05): the design's ON is a sample, not the default.
  shareWithClient: false,
  notifyClient: false,
  tags: [],
  reviewerUserId: '',
};

/** ".pdf" from "Return 2024.pdf"; empty when the name has no ending. */
export const endingOf = (fileName: string) => /\.[a-z0-9]+$/i.exec(fileName)?.[0] ?? '';

/** The name without its ending, for editing. */
export const baseName = (fileName: string) =>
  fileName.slice(0, fileName.length - endingOf(fileName).length);

/** The saved file name: the typed name with the original ending (the API checks it). */
export function savedName(name: string, original: string) {
  const ending = endingOf(original).toLowerCase();
  const typed = name.trim();
  return typed.toLowerCase().endsWith(ending) ? typed : `${typed}${ending}`;
}

export function sizeText(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
