'use client';

import type { MessageAttachment } from '@firmivra/types';
import { Paperclip } from '@phosphor-icons/react';
import { useState } from 'react';
import { errorMessage } from '../lib/errors';

/** "240 KB", "1.5 MB". */
export function fileSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * A message's files (MSG-F12), in the firm's conversation and the portal's: the client's
 * documents (a reply's) and New Message's own files. Each opens through its side's short download
 * link, and only once its security check passed.
 */
export function MessageFiles({
  files,
  open,
}: {
  files: MessageAttachment[];
  /**
   * The side's own download link: a DOCUMENT through Documents (`api.documents.download`,
   * `api.myDocuments(slug).download`), a FILE through Messages (`api.messages.fileDownload`,
   * `api.myMessages(slug).fileDownload`).
   */
  open: (file: MessageAttachment) => Promise<{ url: string }>;
}) {
  const [busy, setBusy] = useState<string>();
  const [problem, setProblem] = useState<string>();
  if (files.length === 0) return null;
  return (
    <ul aria-label="Files" className="flex max-w-full flex-wrap gap-2" data-testid="message-files">
      {files.map((f) => (
        <li key={`${f.kind}${f.id}`} className="max-w-full min-w-0">
          <button
            type="button"
            disabled={f.status !== 'READY' || busy === f.id}
            onClick={() => {
              setBusy(f.id);
              setProblem(undefined);
              open(f)
                .then((link) => window.location.assign(link.url))
                .catch((e: unknown) => setProblem(errorMessage(e)))
                .finally(() => setBusy(undefined));
            }}
            className="inline-flex min-h-9 max-w-full items-center gap-2 rounded-control border border-border bg-surface px-3 text-left text-sm text-heading hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Paperclip aria-hidden className="size-4 shrink-0" />
            <span className="min-w-0 truncate">{f.fileName}</span>
            <span className="shrink-0 text-xs text-muted">
              {f.status === 'READY'
                ? fileSize(f.sizeBytes)
                : f.status === 'CHECKING'
                  ? 'Checking…'
                  : 'Unavailable'}
            </span>
          </button>
        </li>
      ))}
      {problem ? (
        <li role="alert" className="text-xs text-danger">
          {problem}
        </li>
      ) : null}
    </ul>
  );
}
