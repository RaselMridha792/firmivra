'use client';

import { IconButton, RichTextEditor } from '@firmivra/ui';
import { Trash } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import {
  CATEGORIES,
  CATEGORY_LABELS,
  DESCRIPTION_MAX,
  LOGO_MAX_BYTES,
  LOGO_TYPES,
  NAME_MAX,
  SHORT_DESCRIPTION_MAX,
} from '../../../../../../../mocks/admin-integrations';
import { ServiceLogo } from '../../../_components/integration-badges';
import { formatBytes } from '../../../_components/integration-format';
import { OutlineButton } from '../../_components/catalog-parts';
import type { Draft } from './catalog-draft';
import { controlClass, EditCard, Field, helpId } from './edit-parts';

/**
 * General (docx §7): the customer-facing name, category, short and detailed descriptions, the
 * logo (PNG, JPEG or WebP up to 2 MB; the file goes to Firmivra's storage, the entry keeps its
 * metadata) and the website.
 */

export interface TabProps {
  draft: Draft;
  set: (patch: Partial<Draft>) => void;
  errorFor: (id: string) => string | undefined;
  /** Without the right to manage configuration, the form is read-only. */
  locked: boolean;
}

export function GeneralTab({ draft, set, errorFor, locked }: TabProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [logoError, setLogoError] = useState<string | null>(null);

  function pickLogo(file: File | undefined) {
    if (!file) return;
    if (!LOGO_TYPES.some((type) => type === file.type)) {
      setLogoError('Upload the logo as PNG, JPEG or WebP.');
      return;
    }
    if (file.size <= 0 || file.size > LOGO_MAX_BYTES) {
      setLogoError('The logo must be 2 MB or smaller.');
      return;
    }
    setLogoError(null);
    set({ logo: { fileName: file.name, contentType: file.type, sizeBytes: file.size } });
  }

  return (
    <EditCard
      testId="general-information"
      title="General Information"
      subtitle="Update the basic details about this integration."
    >
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <Field id="edit-name" label="Integration Name" required error={errorFor('edit-name')}>
          <input
            id="edit-name"
            className={controlClass(errorFor('edit-name'))}
            value={draft.name}
            maxLength={NAME_MAX}
            required
            disabled={locked}
            aria-invalid={errorFor('edit-name') ? true : undefined}
            aria-describedby={errorFor('edit-name') ? helpId('edit-name') : undefined}
            onChange={(event) => set({ name: event.target.value })}
          />
        </Field>
        <Field id="edit-category" label="Category" required>
          <select
            id="edit-category"
            className={controlClass()}
            value={draft.category}
            required
            disabled={locked}
            onChange={(event) =>
              set({
                category:
                  CATEGORIES.find((value) => value === event.target.value) ?? draft.category,
              })
            }
          >
            {CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {CATEGORY_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field
            id="edit-short"
            label="Short Description"
            required
            error={errorFor('edit-short')}
            counter={`${draft.shortDescription.length}/${SHORT_DESCRIPTION_MAX}`}
          >
            <textarea
              id="edit-short"
              rows={3}
              className={controlClass(errorFor('edit-short'))}
              value={draft.shortDescription}
              maxLength={SHORT_DESCRIPTION_MAX}
              required
              disabled={locked}
              aria-invalid={errorFor('edit-short') ? true : undefined}
              aria-describedby={helpId('edit-short')}
              onChange={(event) => set({ shortDescription: event.target.value })}
            />
          </Field>
        </div>
        <div id="edit-description" tabIndex={-1} className="sm:col-span-2">
          <RichTextEditor
            label="Detailed Description"
            value={draft.description}
            maxLength={DESCRIPTION_MAX}
            error={errorFor('edit-description')}
            disabled={locked}
            onChange={(html) => set({ description: html })}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <p id="edit-logo-label" className="text-sm font-medium text-heading">
            Integration Logo
          </p>
          <div
            role="group"
            aria-labelledby="edit-logo-label"
            className="flex flex-wrap items-center gap-3"
          >
            <ServiceLogo category={draft.category} size="lg" />
            <OutlineButton disabled={locked} onClick={() => fileRef.current?.click()}>
              Change Logo
            </OutlineButton>
            <IconButton
              icon={Trash}
              label="Remove logo"
              disabled={locked || !draft.logo}
              onClick={() => {
                setLogoError(null);
                set({ logo: null });
              }}
            />
            <input
              ref={fileRef}
              type="file"
              accept={LOGO_TYPES.join(',')}
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(event) => {
                pickLogo(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </div>
          <p className="text-xs text-muted">
            {draft.logo
              ? `${draft.logo.fileName} · ${formatBytes(draft.logo.sizeBytes)}. `
              : 'No logo uploaded: the category mark shows. '}
            Recommended size: 512 x 512px (PNG, JPEG or WebP, up to 2 MB).
          </p>
          {logoError ? (
            <p role="alert" className="text-xs text-danger">
              {logoError}
            </p>
          ) : null}
        </div>
        <Field id="edit-website" label="Website URL" error={errorFor('edit-website')}>
          <input
            id="edit-website"
            type="url"
            inputMode="url"
            placeholder="https://"
            className={controlClass(errorFor('edit-website'))}
            value={draft.websiteUrl}
            disabled={locked}
            aria-invalid={errorFor('edit-website') ? true : undefined}
            aria-describedby={errorFor('edit-website') ? helpId('edit-website') : undefined}
            onChange={(event) => set({ websiteUrl: event.target.value })}
          />
        </Field>
      </div>
    </EditCard>
  );
}
