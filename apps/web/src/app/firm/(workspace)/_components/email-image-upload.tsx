'use client';

import { EMAIL_IMAGE_LIMITS } from '@firmivra/types';
import { useRef, useState } from 'react';
import { api } from '../../../../lib/api';
import { errorMessage } from '../../../../lib/errors';
import { uploadImage } from '../../../../lib/upload';

// The firm's email images (L4): one upload for every signature and lead email editor. The image
// goes to the firm's `email-images` on the portal, the only images the API keeps in a signature
// or a lead email; any other image is dropped when it is cleaned.

/** The editor's image sizing: as wide as an email allows. */
export const EMAIL_IMAGE_SIZING = {
  minWidth: EMAIL_IMAGE_LIMITS.minWidth,
  maxWidth: EMAIL_IMAGE_LIMITS.maxWidth,
};

/** An email image's refusals in words (lib/upload.ts checks a file first). */
export const EMAIL_IMAGE_ERRORS: Record<string, string> = {
  FILE_TYPE_NOT_ALLOWED: 'Use a PNG, JPG or GIF image.',
  FILE_EMPTY: 'That image is empty.',
  FILE_TOO_LARGE: 'That image is too large: at most 2 MB.',
  UPLOAD_MISMATCH: 'The image changed while it was uploading. Try again.',
  UPLOAD_EXPIRED: 'The upload took too long. Try again.',
};

/**
 * The image button: picks one file, uploads it, and answers its address (null if it failed).
 * `area` is the screen's own upload route, so the member needs only that area's access (C21: My
 * Signature in Communications); both store to the same firm email images.
 */
export function useEmailImageUpload(area: 'leads' | 'communications' = 'leads') {
  const inputRef = useRef<HTMLInputElement>(null);
  const waitingRef = useRef<((file: File | null) => void) | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const insert = async (): Promise<string | null> => {
    setProblem(null);
    const file = await new Promise<File | null>((resolve) => {
      waitingRef.current = resolve;
      inputRef.current?.click();
    });
    if (!file) return null;
    setBusy(true);
    try {
      const image = await uploadImage(file, {
        contentTypes: EMAIL_IMAGE_LIMITS.contentTypes,
        maxBytes: EMAIL_IMAGE_LIMITS.maxBytes,
        start: (body) =>
          area === 'communications'
            ? api.communications.createImageUpload(body)
            : api.leadPipeline.createEmailImageUpload(body),
        finish: (uploadToken) =>
          area === 'communications'
            ? api.communications.confirmImageUpload({ uploadToken })
            : api.leadPipeline.confirmEmailImageUpload({ uploadToken }),
      });
      return image.url;
    } catch (error) {
      setProblem(errorMessage(error, EMAIL_IMAGE_ERRORS));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept={EMAIL_IMAGE_LIMITS.contentTypes.join(',')}
      className="sr-only"
      tabIndex={-1}
      aria-hidden
      data-testid="email-image-file"
      onChange={(e) => {
        const file = e.target.files?.[0] ?? null;
        e.target.value = '';
        waitingRef.current?.(file);
        waitingRef.current = null;
      }}
    />
  );
  return { insert, fileInput, problem, busy };
}
