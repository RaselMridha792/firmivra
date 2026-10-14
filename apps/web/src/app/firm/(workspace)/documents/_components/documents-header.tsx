import { Envelope, UploadSimple } from '@phosphor-icons/react';
import { moduleHref } from '../../../../../lib/firm-modules';
import { ButtonLink } from './button-link';

/**
 * Document Requests and Upload Document open Frame 3 and Frame 1 of the design, neither built yet
 * (R34 PR: the two new /modules/<slug> placeholders added for this ticket).
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
        <ButtonLink
          variant="primary"
          href={moduleHref('document-upload')}
          data-testid="open-upload-document"
        >
          <UploadSimple weight="regular" className="size-5" aria-hidden="true" />
          Upload Document
        </ButtonLink>
      </div>
    </div>
  );
}
