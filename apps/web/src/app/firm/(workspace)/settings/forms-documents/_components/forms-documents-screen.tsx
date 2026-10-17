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
import { moduleHref } from '../../../../../../lib/firm-modules';
import { useApiQuery } from '../../../../../../lib/query';
import {
  CardLink,
  Facts,
  Loaded,
  SettingsCard,
  SettingsHeader,
} from '../../_components/settings-parts';

const MB = UPLOAD_LIMITS.maxBytes / (1024 * 1024);

/**
 * Settings > Forms & Documents (guide §11: allowed file types and limits, naming and storage
 * defaults, categories and retention references). The limits are the ones the document
 * contract fixes for every firm (`UPLOAD_LIMITS`), the categories are the firm's own
 * (`api.documents.categories`), and each card opens the page that changes it. No firm-wide
 * document defaults are stored yet (Settings contract).
 */
export function FormsDocumentsScreen() {
  const categories = useApiQuery(['documents', 'categories'], () => api.documents.categories());
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
          subtitle="What clients and staff can upload, everywhere in Firmivra."
          icon={FolderOpen}
          testId="allowed-files"
        >
          <Facts
            rows={[
              ['File types', UPLOAD_LIMITS.typeNames],
              ['Largest file', `${MB} MB`],
              ['Office files with macros', 'Refused'],
            ]}
          />
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
          subtitle="How long records are kept (platform policy)."
          icon={Scales}
          testId="retention"
        >
          <Facts
            rows={[
              ['Tax records', '7 years'],
              ['Payroll records', 'At least 4 years'],
              ['Business formation records', 'Kept permanently'],
              ['Legal hold', 'Stops any removal while it lasts'],
            ]}
          />
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
            <CardLink href={moduleHref('templates')}>Templates</CardLink>
            <CardLink href="/settings/legal">Terms &amp; Privacy</CardLink>
            <CardLink href="/firm-sign">Firm Sign</CardLink>
          </div>
        </SettingsCard>
      </div>
    </div>
  );
}
