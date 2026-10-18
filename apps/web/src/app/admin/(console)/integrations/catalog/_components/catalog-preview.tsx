'use client';

import { Badge, Button, Callout, Modal } from '@firmivra/ui';
import { EyeSlash, Info, LockKey, Warning } from '@phosphor-icons/react';
import { useApiQuery } from '../../../../../../lib/query';
import { adminIntegrations, CATEGORY_LABELS } from '../../../../../../mocks/admin-integrations';
import { CatalogStatusBadge, ServiceLogo } from '../../_components/integration-badges';
import { Loaded } from '../../_components/integration-states';
import { CATALOG_AUTH_LABELS } from './catalog-parts';

/**
 * View in Catalog (docx §7): a read-only preview of how firms see the entry, from the saved
 * version. It never shows live customer data. Rich text is shown as plain text here.
 */

/** The description's words without its markup (lists and paragraphs become new lines). */
export function plainText(html: string | null): string {
  return (html ?? '')
    .replace(/<(br|\/p|\/li|\/h3|\/h4|\/blockquote)[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function CatalogPreviewDialog({
  catalogId,
  note,
  onClose,
}: {
  catalogId: string;
  /** A line above the preview ("Unsaved changes are not in the preview."). */
  note?: string;
  onClose: () => void;
}) {
  const preview = useApiQuery(['admin-integrations', 'catalog', catalogId, 'preview'], () =>
    adminIntegrations.previewCatalog(catalogId),
  );
  return (
    <Modal
      open
      title="Catalog Preview"
      subtitle="How customer firms see this integration. No customer data is shown."
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div data-testid="catalog-preview" className="flex max-w-xl flex-col gap-4">
        {note ? <p className="text-sm text-muted">{note}</p> : null}
        <Loaded query={preview} rows={5}>
          {(entry) => (
            <div className="flex flex-col gap-4">
              {entry.hidden ? (
                <Callout size="compact" surface="plain" icon={EyeSlash} tone="grey">
                  Disabled: firms don&apos;t see this entry in their catalog.
                </Callout>
              ) : null}
              {entry.deprecationNotice ? (
                <Callout size="compact" surface="warning" icon={Warning} tone="amber">
                  {entry.deprecationNotice}
                </Callout>
              ) : null}
              <article className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
                <div className="flex items-start gap-4">
                  <ServiceLogo category={entry.category} size="md" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <h3 className="text-lg font-bold text-heading">{entry.name}</h3>
                    <p className="text-xs text-muted">{CATEGORY_LABELS[entry.category]}</p>
                    {entry.badges.length ? (
                      <ul aria-label="Badges" className="flex flex-wrap gap-1.5">
                        {entry.badges.map((badge) => (
                          <li key={badge}>
                            <Badge tone="info">{badge}</Badge>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <CatalogStatusBadge status={entry.status} />
                </div>
                <p className="text-sm text-heading">{entry.shortDescription}</p>
                {entry.description ? (
                  <p className="text-sm whitespace-pre-line text-text">
                    {plainText(entry.description)}
                  </p>
                ) : null}
                <div>
                  <Button disabled={!entry.connectable} tabIndex={-1} title="Preview only">
                    {entry.connectLabel}
                    <span className="sr-only"> (preview only)</span>
                  </Button>
                </div>
              </article>
              <section aria-label="How to connect" className="flex flex-col gap-2 text-sm">
                <h3 className="font-semibold text-heading">How to connect</h3>
                <p className="text-text">{CATALOG_AUTH_LABELS[entry.setup.authType]}</p>
                {entry.setup.instructions ? (
                  <p className="whitespace-pre-line text-text">{entry.setup.instructions}</p>
                ) : null}
                {entry.setup.requiredFields.length ? (
                  <ul className="flex flex-col gap-1">
                    {entry.setup.requiredFields.map((field) => (
                      <li key={field.key} className="flex items-center gap-2">
                        {field.secret ? (
                          <LockKey aria-hidden weight="fill" className="size-4 text-muted" />
                        ) : (
                          <Info aria-hidden weight="fill" className="size-4 text-muted" />
                        )}
                        <span className="text-heading">
                          {field.label}
                          {field.required ? '' : ' (optional)'}
                        </span>
                        {field.help ? <span className="text-muted">· {field.help}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {entry.setup.helpText ? <p className="text-muted">{entry.setup.helpText}</p> : null}
                <p className="flex flex-wrap gap-4">
                  {entry.websiteUrl ? (
                    <a
                      href={entry.websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-link hover:underline"
                    >
                      Website
                    </a>
                  ) : null}
                  {entry.helpUrl ? (
                    <a
                      href={entry.helpUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-link hover:underline"
                    >
                      Setup guide
                    </a>
                  ) : null}
                </p>
              </section>
            </div>
          )}
        </Loaded>
      </div>
    </Modal>
  );
}
