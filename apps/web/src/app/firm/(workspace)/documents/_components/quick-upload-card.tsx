import { UPLOAD_LIMITS } from '@firmivra/types';
import { Card } from '@firmivra/ui';
import { UploadSimple } from '@phosphor-icons/react';
import Link from 'next/link';
import { moduleHref } from '../../../../../lib/firm-modules';

/**
 * Opens Frame 1, not built yet (the full upload flow needs a client/service/category form this
 * ticket does not build). The accepted-type text is the API's real UPLOAD_LIMITS, not the design's
 * text (which lists .doc and .xls — the API refuses both): R34 PR.
 */
export function QuickUploadCard() {
  return (
    <Card className="p-4" data-testid="quick-upload-card">
      <h2 className="mb-3 text-lg font-bold text-heading">Quick Upload</h2>
      <Link
        href={moduleHref('document-upload')}
        data-testid="quick-upload-dropzone"
        className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-action px-4 py-8 text-center hover:bg-folder-surface"
      >
        <UploadSimple weight="bold" className="size-8 text-action" aria-hidden="true" />
        <span className="font-semibold text-heading">
          Drag &amp; drop files here
          <br />
          or click to upload
        </span>
      </Link>
      <p className="mt-3 text-center text-xs text-muted">
        Supports {UPLOAD_LIMITS.typeNames}
        <br />
        (Max {UPLOAD_LIMITS.maxBytes / (1024 * 1024)}MB per file)
      </p>
    </Card>
  );
}
