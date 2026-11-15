'use client';

import { UPLOAD_LIMITS } from '@firmivra/types';
import {
  Archive,
  ClipboardText,
  Files,
  FolderOpen,
  Scales,
  ShieldCheck,
} from '@phosphor-icons/react';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import {
  CardLink,
  Facts,
  Loaded,
  SettingsCard,
  SettingsHeader,
} from '../../_components/settings-parts';

const MB = 1024 * 1024;

/**
 * Settings > Forms & Documents (guide §11: allowed file types and limits, naming and storage
 * defaults, categories and retention references; review of Oct 19 in
 * docs/specs/settings-review-2026-10-20/). The limits are the ones the document contract fixes
 * for every firm (`UPLOAD_LIMITS`: the largest file, and the batch the browser checks), the
 * categories are the firm's own (`api.documents.categories`), and each card opens the page that
 * changes it. Retention reads as the firm's own recordkeeping: records stay until the firm
 * deletes them, and nothing here promises that Firmivra keeps them forever.
 */
/** "20 MB", or why it isn't shown. */
function sizeText(query: { isPending: boolean; data: number | undefined }): string {
  if (query.isPending) return 'Loading…';
  return query.data === undefined ? 'Not available right now' : `${query.data} MB`;
}

export function FormsDocumentsScreen() {
  const categories = useApiQuery(['documents', 'categories'], () => api.documents.categories());
  // DOCUMENTS-LIMIT-01: each limit is the firm's own and set where it applies.
  const documentSettings = useApiQuery(['documents', 'settings', 'limit'], () =>
    api.documentLibrary.settings(),
  );
  const intakeSettings = useApiQuery(['intake-forms', 'settings'], () =>
    api.intakeForms.settings(),
  );
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <SettingsHeader
        icon={Files}
        title="Forms & Documents"
        subtitle="Allowed files, storage, categories and the forms and templates your firm uses."
      />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <SettingsCard
          title="Allowed Files"
          subtitle="What clients and staff can upload, and where each limit is set."
          icon={FolderOpen}
          testId="allowed-files"
          action={<CardLink href="/documents/settings">File Settings</CardLink>}
        >
          <Facts
            rows={[
              ['File types', UPLOAD_LIMITS.typeNames],
              [
                'Largest document',
                sizeText({
                  isPending: documentSettings.isPending,
                  data: documentSettings.data?.maxFileSizeMb,
                }),
              ],
              [
                'Largest intake form file',
                sizeText({
                  isPending: intakeSettings.isPending,
                  data: intakeSettings.data?.security.maxFileSizeMb,
                }),
              ],
              ['Firmivra’s own limit', `${UPLOAD_LIMITS.maxBytes / MB} MB a file`],
              [
                'Files per upload',
                `Up to ${UPLOAD_LIMITS.maxBatchFiles}, ${UPLOAD_LIMITS.maxBatchBytes / MB} MB in all`,
              ],
              ['Office files with macros', 'Refused'],
            ]}
          />
          <p className="mt-2 text-xs text-muted" data-testid="limit-scope">
            Documents and the client portal take files up to the largest document size, set in
            Documents &gt; Settings &gt; File Settings. Intake forms have their own, set in Intake
            Form Settings. Neither goes past Firmivra’s own limit.
          </p>
        </SettingsCard>

        <SettingsCard
          title="Storage & Security"
          subtitle="How every uploaded file is kept."
          icon={ShieldCheck}
          tone="green"
          testId="storage"
        >
          <Facts
            rows={[
              ['Where', 'Your firm’s private, encrypted storage'],
              ['Malware scan', 'Before anyone can open a file'],
              ['Sharing', 'Short-lived links for signed-in people only'],
            ]}
          />
        </SettingsCard>

        <SettingsCard
          title="Document Categories"
          subtitle="How documents are sorted in your firm."
          icon={Archive}
          testId="categories"
          action={<CardLink href="/documents">Open Documents</CardLink>}
        >
          <Loaded query={categories}>
            {(list) =>
              list.some((c) => !c.archivedAt) ? (
                <Facts
                  rows={list
                    .filter((c) => !c.archivedAt)
                    .map((c) => [
                      c.name,
                      c.retentionYears ? `Kept ${c.retentionYears} years` : 'Kept for good',
                    ])}
                />
              ) : (
                <p className="rounded-lg bg-subtle p-4 text-sm text-muted">
                  No categories yet. Add them in Documents.
                </p>
              )
            }
          </Loaded>
        </SettingsCard>

        <SettingsCard
          title="Retention"
          subtitle="While your account is active, records stay until your firm deletes them."
          icon={Scales}
          testId="retention"
        >
          <Facts
            rows={[
              ['Tax records', '7 years'],
              ['Payroll records', 'At least 4 years'],
              ['Business formation records', 'Permanently, in your firm’s own records'],
              ['Legal hold', 'Stops any removal while it lasts'],
            ]}
          />
          <p className="text-sm text-muted">
            These periods are guidance for your firm’s recordkeeping, not legal minimums. Firmivra
            does not keep records forever: your firm is responsible for keeping any it needs after
            its access to Firmivra ends.
          </p>
        </SettingsCard>

        <SettingsCard
          title="Forms & Templates"
          subtitle="The forms clients fill in and the templates your staff reuse."
          icon={ClipboardText}
          testId="forms-templates"
          className="lg:col-span-2"
        >
          <div className="flex flex-wrap gap-3">
            <CardLink href="/intake-forms/settings">Intake Form Settings</CardLink>
            <CardLink href="/templates">Templates</CardLink>
            <CardLink href="/settings/legal">Terms &amp; Privacy</CardLink>
            <CardLink href="/firm-sign">Firm Sign</CardLink>
          </div>
        </SettingsCard>
      </div>
    </div>
  );
}
