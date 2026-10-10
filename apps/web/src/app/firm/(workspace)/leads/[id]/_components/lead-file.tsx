'use client';

import type { LeadUpload } from '@firmivra/types';
import { Badge, Button } from '@firmivra/ui';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';
import { LEAD_ERRORS } from './lead-shared';

const size = (bytes: number) =>
  bytes < 1_000_000
    ? `${Math.max(1, Math.round(bytes / 1000))} KB`
    : `${(bytes / 1_000_000).toFixed(1)} MB`;

/** A file the visitor uploaded. Only a CLEAN one downloads, through a short-lived link. */
export function LeadFile({ leadId, file }: { leadId: string; file: LeadUpload }) {
  const download = useApiMutation(() => api.leads.downloadUpload(leadId, file.id));
  return (
    <li data-testid="lead-file" className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 break-all text-sm text-text">{file.fileName}</span>
        <span className="text-xs text-muted">{size(file.sizeBytes)}</span>
        {file.scanStatus === 'CLEAN' ? (
          <Button
            variant="ghost"
            aria-label={`Download ${file.fileName}`}
            disabled={download.isPending}
            onClick={() =>
              download.mutate(undefined, { onSuccess: (link) => window.location.assign(link.url) })
            }
          >
            Download
          </Button>
        ) : (
          <Badge tone={file.scanStatus === 'PENDING' ? 'warning' : 'danger'}>
            {file.scanStatus === 'PENDING' ? 'Being checked' : 'Blocked'}
          </Badge>
        )}
      </div>
      {download.error ? (
        <p role="alert" className="text-xs text-danger">
          {errorMessage(download.error, LEAD_ERRORS)}
        </p>
      ) : null}
    </li>
  );
}
