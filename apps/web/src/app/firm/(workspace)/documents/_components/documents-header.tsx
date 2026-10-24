import { Envelope, UploadSimple } from '@phosphor-icons/react';
import { moduleHref } from '../../../../../lib/firm-modules';
import { ButtonLink } from './button-link';

/**
 * Upload Document opens Frame 1 (`/documents/upload`). Document Requests opens Frame 3, not built
 * yet (its /modules/<slug> placeholder).
 */
export function DocumentsHeader() {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <h1 data-testid="page-title" className="text-3xl font-bold text-heading">
          Documents
        </h1>
        <p className="mt-1 text-sm text-link">
          Securely manage, store, and share client and firm documents.
        </p>
      </div>
      <div className="flex shrink-0 gap-3">
        <ButtonLink
          variant="secondary"
          href={moduleHref('document-requests')}
          data-testid="open-document-requests"
        >
          <Envelope weight="regular" className="size-5" aria-hidden="true" />
          Document Requests
        </ButtonLink>
        <ButtonLink variant="primary" href="/documents/upload" data-testid="open-upload-document">
          <UploadSimple weight="regular" className="size-5" aria-hidden="true" />
          Upload Document
        </ButtonLink>
      </div>
    </div>
  );
}
