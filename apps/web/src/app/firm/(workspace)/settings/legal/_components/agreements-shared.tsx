'use client';

import type { AgreementVersionSummary, FirmAgreementSummary } from '@firmivra/types';
import { Badge } from '@firmivra/ui';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { PdfDownload } from './agreement-pdf';

/** Every agreement query starts with this key, so one invalidate refreshes the list and versions. */
export const AGREEMENTS = ['firm-settings', 'agreements'];
export const agreementKey = (id: string) => [...AGREEMENTS, id];
const versionKey = (id: string, version: number) => [...AGREEMENTS, id, 'version', version];

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { dateStyle: 'medium', timeZone: 'UTC' });

export const scopeLabel = (agreement: Pick<FirmAgreementSummary, 'scope' | 'service'>) =>
  agreement.scope === 'ALL_INTAKES'
    ? 'Firm-wide: every Begin Online form and portal intake'
    : `Service: ${agreement.service?.name ?? 'Unknown service'}`;

/** "Version 2, published Oct 6, 2026 · effective Oct 1, 2026" */
export const versionLine = (version: AgreementVersionSummary) =>
  [
    `Version ${version.version}, published ${day(version.publishedAt)}`,
    version.effectiveDate ? `effective ${day(`${version.effectiveDate}T00:00:00Z`)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

/**
 * One version as the signer reads it: the text (shown as written, never as HTML, until the
 * shared Markdown component lands in packages/ui) and its boxes.
 */
export function VersionText({ agreementId, version }: { agreementId: string; version: number }) {
  const full = useApiQuery(versionKey(agreementId, version), () =>
    api.agreements.getVersion(agreementId, version),
  );
  return (
    <PageState query={full}>
      {(v) => (
        <div className="flex flex-col gap-4">
          {v.pdf ? <PdfDownload pdf={v.pdf} /> : null}
          <p className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded-control bg-canvas p-4 text-sm text-text">
            {v.bodyMarkdown}
          </p>
          {v.acknowledgments.length ? (
            <ul className="flex flex-col gap-2" aria-label="Boxes the signer ticks">
              {v.acknowledgments.map((box) => (
                <li key={box.key} className="text-sm">
                  <span className="flex flex-wrap items-center gap-2 font-medium text-text">
                    {box.label}
                    <Badge tone={box.required ? 'info' : 'neutral'}>
                      {box.required ? 'Required' : 'Optional'}
                    </Badge>
                  </span>
                  <span className="text-muted">{box.text}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </PageState>
  );
}
