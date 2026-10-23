'use client';

import { EMAIL_FONT_SIZES, EMAIL_FONTS, EMAIL_IMAGE_LIMITS } from '@firmivra/types';
import { Button, RichTextEditor } from '@firmivra/ui';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { uploadImage } from '../../../../../lib/upload';
import { EMAIL_EXTRA_ERRORS, withSignature } from './lead-message';

// The Send Email message (Octavia's Leads review, item 8; L4): fonts, sizes, bold and italic, and
// images uploaded, resized and placed in the text, with the member's saved signature (which may
// carry the firm's logo) under it, as in an email app. The API cleans the HTML to the same rules,
// so what the composer shows is what the lead receives.

export const SIGNATURE_KEY = ['lead-pipeline', 'signature'] as const;
const SIZING = { minWidth: EMAIL_IMAGE_LIMITS.minWidth, maxWidth: EMAIL_IMAGE_LIMITS.maxWidth };
/** A new email: an empty first line to write on. */
const BLANK = '<p><br></p>';

/** The image button: picks one file, uploads it, and answers its address (null if it failed). */
function useImageUpload() {
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
        start: (body) => api.leadPipeline.createEmailImageUpload(body),
        finish: (uploadToken) => api.leadPipeline.confirmEmailImageUpload({ uploadToken }),
      });
      return image.url;
    } catch (error) {
      setProblem(errorMessage(error, EMAIL_EXTRA_ERRORS));
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

interface EmailMessageFieldProps {
  /** The email's HTML as it will be sent, on every change (the signature included). */
  onChange: (html: string) => void;
  error?: string;
}

export function EmailMessageField({ onChange, error }: EmailMessageFieldProps) {
  const images = useImageUpload();
  const signatureImages = useImageUpload();
  const signature = useApiQuery(SIGNATURE_KEY, () => api.leadPipeline.signature());
  const saved = signature.data?.html ?? null;
  // Null until the member writes: then the saved signature (once loaded) sits under a blank line.
  const [message, setMessage] = useState<string | null>(null);
  const shown = message ?? (signature.isPending ? '' : withSignature(BLANK, saved));
  useEffect(() => onChange(shown), [shown, onChange]);

  const [draft, setDraft] = useState<string | null>(null);
  const save = useApiMutation((html: string) => api.leadPipeline.saveSignature({ html }), {
    invalidate: [...SIGNATURE_KEY],
  });
  const logo = signature.data?.logoUrl ?? null;
  return (
    <div className="flex flex-col gap-3">
      {images.fileInput}
      {signatureImages.fileInput}
      <RichTextEditor
        label="Message"
        required
        value={shown}
        onChange={setMessage}
        error={error ?? images.problem ?? undefined}
        hint={images.busy ? 'Uploading the image…' : 'Click an image to resize or place it.'}
        fonts={EMAIL_FONTS}
        fontSizes={EMAIL_FONT_SIZES}
        imageSizing={SIZING}
        noLinks
        onInsertImage={images.insert}
      />
      <section
        aria-label="Signature"
        className="flex flex-col gap-2 rounded-lg bg-canvas px-3 py-2 text-sm"
        data-testid="email-signature"
      >
        {draft === null ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-text">
              {signature.isPending
                ? 'Loading your signature…'
                : signature.isError
                  ? 'Your saved signature could not be loaded. You can still send this email.'
                  : saved
                    ? 'Your saved signature is added under the message.'
                    : 'You have no saved signature yet.'}
            </span>
            <div className="flex flex-wrap gap-2">
              {saved ? (
                <Button
                  variant="secondary"
                  onClick={() => setMessage(withSignature(shown || BLANK, saved))}
                >
                  Insert my signature
                </Button>
              ) : null}
              <Button
                variant="secondary"
                disabled={signature.isPending || signature.isError}
                onClick={() => {
                  save.reset();
                  setDraft(saved ?? '');
                }}
              >
                {saved ? 'Edit signature' : 'Create signature'}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <RichTextEditor
              label="Your signature"
              value={draft}
              onChange={setDraft}
              fonts={EMAIL_FONTS}
              fontSizes={EMAIL_FONT_SIZES}
              imageSizing={SIZING}
              noLinks
              onInsertImage={signatureImages.insert}
              hint={
                signatureImages.busy
                  ? 'Uploading the image…'
                  : 'Saved for your emails to leads. Up to about 1000 characters of formatted text.'
              }
              error={
                signatureImages.problem ??
                (save.error ? errorMessage(save.error, EMAIL_EXTRA_ERRORS) : undefined)
              }
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={!logo}
                title={
                  logo ? undefined : 'Add an email logo in Settings > Company Profile & Branding'
                }
                onClick={() =>
                  setDraft(`${draft}<p><img src="${logo ?? ''}" alt="" style="width: 160px;"></p>`)
                }
              >
                Insert firm logo
              </Button>
              <Button
                disabled={save.isPending}
                onClick={() =>
                  save.mutate(draft, {
                    onSuccess: () => setDraft(null),
                  })
                }
              >
                {save.isPending ? 'Saving…' : 'Save signature'}
              </Button>
              <Button variant="secondary" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
