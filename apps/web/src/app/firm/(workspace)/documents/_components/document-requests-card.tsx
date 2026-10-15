import { Card } from '@firmivra/ui';
import { Folder } from '@phosphor-icons/react';
import { moduleHref } from '../../../../../lib/firm-modules';
import { ButtonLink } from './button-link';

/** Opens Frame 4, not built yet (R34 PR). */
export function DocumentRequestsCard() {
  return (
    <Card className="p-4" data-testid="document-requests-card">
      <div className="flex items-start gap-3">
        <Folder weight="fill" className="size-8 shrink-0 text-folder-icon" aria-hidden="true" />
        <div>
          <h2 className="text-lg font-bold text-heading">Document Requests</h2>
          <p className="mt-1 text-sm text-text">
            Request specific documents from clients or team members.
          </p>
        </div>
      </div>
      <ButtonLink
        variant="outline"
        href={moduleHref('document-requests')}
        className="mt-4 w-full"
        data-testid="create-document-request"
      >
        Create Document Request
      </ButtonLink>
    </Card>
  );
}
