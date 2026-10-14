'use client';

import { DOCUMENT_ERRORS, type FirmSettings, LOGO_ERRORS, LOGO_LIMITS } from '@firmivra/types';
import { Button } from '@firmivra/ui';
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
 * The firm's logo (the setup wizard's branding step and Settings > Branding): preview, Upload or
 * Replace, and Remove. It saves at once, apart from the form's other fields. Until a logo is
 * uploaded, the Firmivra logo stays.
 */
export function LogoField({ firm }: { firm: FirmSettings }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [done, setDone] = useState<string | null>(null);
  const upload = useApiMutation(
    (file: File) =>
      uploadLogo(file, {
        start: (body) => api.settings.createLogoUpload(body),
        finish: (uploadToken) => api.settings.confirmLogoUpload({ uploadToken }),
      }),
    { invalidate: FIRM_SETTINGS },
  );
  const remove = useApiMutation((_: void) => api.settings.removeLogo(), {
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
    upload.mutate(file, { onSuccess: () => setDone('Logo saved.') });
  };
  const clear = () => {
    setDone(null);
    upload.reset();
    remove.mutate(undefined, { onSuccess: () => setDone('Logo removed.') });
  };

  return (
    <div className="flex flex-col gap-2" data-testid="logo-field">
      <p className="text-sm font-medium text-text">Logo</p>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-16 w-40 items-center justify-center rounded-control border border-border bg-surface p-2">
          {firm.logoUrl ? (
            <Image
              unoptimized
              src={firm.logoUrl}
              alt={`${firm.name} logo`}
              width={144}
              height={48}
              className="h-auto max-h-12 w-auto object-contain"
            />
          ) : (
            <span className="text-center text-xs text-muted">Firmivra logo</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {upload.isPending ? 'Uploading…' : firm.logoUrl ? 'Replace logo' : 'Upload logo'}
          </Button>
          {firm.logoUrl ? (
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
          aria-label="Logo file"
          data-testid="logo-input"
          onChange={pick}
        />
      </div>
      <p className="text-sm text-muted">
        {LOGO_LIMITS.typeNames}, up to 2 MB. The Firmivra logo shows until you upload yours.
      </p>
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
