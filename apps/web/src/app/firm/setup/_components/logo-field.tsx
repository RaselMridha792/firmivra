'use client';

import {
  DOCUMENT_ERRORS,
  type FirmSettings,
  LOGO_ERRORS,
  LOGO_LIMITS,
  type LogoVariant,
} from '@firmivra/types';
import { Button } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import Image from 'next/image';
import { type ChangeEvent, useRef, useState } from 'react';
import { api } from '../../../../lib/api';
import { errorMessage } from '../../../../lib/errors';
import { useApiMutation } from '../../../../lib/query';
import { uploadLogo } from '../../../../lib/upload';
import { FIRM_SETTINGS } from './shared';

const MESSAGES = { ...LOGO_ERRORS, UPLOAD_FAILED: DOCUMENT_ERRORS.UPLOAD_FAILED };
const ACCEPT = [...Object.keys(LOGO_LIMITS.types), ...Object.values(LOGO_LIMITS.types).flat()];

/**
 * One of the firm's two logos (the setup wizard's branding step and Settings > Branding): a
 * preview on the background it is made for, Upload or Replace, and Remove. It saves at once, apart
 * from the form's other fields.
 */
export function LogoField({
  firm,
  variant,
  label,
}: {
  firm: FirmSettings;
  variant: LogoVariant;
  label: string;
}) {
  const logoUrl = variant === 'light' ? firm.logoLightUrl : firm.logoUrl;
  const inputRef = useRef<HTMLInputElement>(null);
  const [done, setDone] = useState<string | null>(null);
  const client = useQueryClient();
  // The firm sidebar reads the logo from the portal info, under its own key.
  const refreshSidebar = () =>
    client.invalidateQueries({ queryKey: ['firm', firm.business.id, 'branding'] });
  const upload = useApiMutation(
    (file: File) =>
      uploadLogo(file, {
        start: (body) => api.settings.createLogoUpload({ ...body, variant }),
        finish: (uploadToken) => api.settings.confirmLogoUpload({ uploadToken }),
      }),
    { invalidate: FIRM_SETTINGS },
  );
  const remove = useApiMutation((_: void) => api.settings.removeLogo(variant), {
    invalidate: FIRM_SETTINGS,
  });
  const error = upload.error ?? remove.error;
  const busy = upload.isPending || remove.isPending;

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // the same file can be picked again
    if (!file) return;
    setDone(null);
    remove.reset();
    upload.mutate(file, {
      onSuccess: () => {
        setDone('Logo saved.');
        void refreshSidebar();
      },
    });
  };
  const clear = () => {
    setDone(null);
    upload.reset();
    remove.mutate(undefined, {
      onSuccess: () => {
        setDone('Logo removed.');
        void refreshSidebar();
      },
    });
  };

  return (
    <div className="flex flex-col gap-2" data-testid={`logo-field-${variant}`}>
      <p className="text-sm font-medium text-text">{label}</p>
      <div className="flex flex-wrap items-center gap-4">
        <div
          className={`flex h-20 w-48 items-center justify-center rounded-control border border-border p-2 ${variant === 'dark' ? 'bg-brand-900' : 'bg-surface'}`}
        >
          {logoUrl ? (
            <Image
              unoptimized
              src={logoUrl}
              alt={`${firm.name} logo for ${variant} backgrounds`}
              width={176}
              height={64}
              className="h-auto max-h-16 w-auto max-w-full object-contain"
            />
          ) : (
            <span
              className={`text-center text-xs ${variant === 'dark' ? 'text-brand-100' : 'text-muted'}`}
            >
              No logo yet
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {upload.isPending ? 'Uploading…' : logoUrl ? 'Replace logo' : 'Upload logo'}
          </Button>
          {logoUrl ? (
            <Button type="button" variant="ghost" disabled={busy} onClick={clear}>
              {remove.isPending ? 'Removing…' : 'Remove logo'}
            </Button>
          ) : null}
        </div>
        <input
          ref={inputRef}
          type="file"
          hidden
          accept={ACCEPT.join(',')}
          aria-label={`${label} file`}
          data-testid={`logo-input-${variant}`}
          onChange={pick}
        />
      </div>
      <p className="text-sm text-muted">{LOGO_LIMITS.typeNames}, up to 2 MB.</p>
      {done && !error ? (
        <p role="status" className="text-sm text-success">
          {done}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(error, MESSAGES)}
        </p>
      ) : null}
    </div>
  );
}
