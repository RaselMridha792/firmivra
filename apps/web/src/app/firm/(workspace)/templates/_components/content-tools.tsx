'use client';

import { EMAIL_IMAGE_LIMITS } from '@firmivra/types';
import { Button, HTTPS_LINK, Input, Modal } from '@firmivra/ui';
import { type FormEvent, useRef, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { uploadImage } from '../../../../../lib/upload';

// TP-F07: what a template's rich content can hold besides text (the editor's opt-in tools): an
// image uploaded to the firm's email images and placed in the text, and a call-to-action button
// (an https link drawn as a button). The API cleans both again on save.

/** Images in the content: at most 600 px wide, as an email shows them. */
export const IMAGE_SIZING = {
  minWidth: EMAIL_IMAGE_LIMITS.minWidth,
  maxWidth: EMAIL_IMAGE_LIMITS.maxWidth,
} as const;

const IMAGE_ERRORS: Record<string, string> = {
  FILE_TYPE_NOT_ALLOWED: 'Use a PNG, JPG or GIF image.',
  FILE_EMPTY: 'That image is empty.',
  FILE_TOO_LARGE: 'That image is too large: at most 2 MB.',
  UPLOAD_MISMATCH: 'The image changed while it was uploading. Try again.',
  UPLOAD_EXPIRED: 'The upload took too long. Try again.',
};

/**
 * The image tool: picks one file, uploads it, and answers its public address (null if not).
 * Templates (TP-F07) and Communications (CM-F08) each have their own routes to the same images.
 */
export function useContentImages(through: 'templates' | 'communications' = 'templates') {
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
          through === 'templates'
            ? api.templates.createImageUpload(body)
            : api.communications.createImageUpload(body),
        finish: (uploadToken) =>
          through === 'templates'
            ? api.templates.confirmImageUpload({ uploadToken })
            : api.communications.confirmImageUpload({ uploadToken }),
      });
      return image.url;
    } catch (error) {
      setProblem(errorMessage(error, IMAGE_ERRORS));
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
      data-testid="content-image-file"
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

type ButtonAnswer = { label: string; href: string } | null;

/** The button tool: a small dialog for the button's words and its https address. */
export function useButtonDialog() {
  const waitingRef = useRef<((answer: ButtonAnswer) => void) | null>(null);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [href, setHref] = useState('https://');
  const [error, setError] = useState<{ label?: string; href?: string }>({});
  const finish = (answer: ButtonAnswer) => {
    setOpen(false);
    waitingRef.current?.(answer);
    waitingRef.current = null;
  };
  const ask = () =>
    new Promise<ButtonAnswer>((resolve) => {
      waitingRef.current = resolve;
      setLabel('');
      setHref('https://');
      setError({});
      setOpen(true);
    });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found: typeof error = {};
    if (!label.trim()) found.label = 'Enter the words on the button';
    if (!HTTPS_LINK.test(href.trim())) found.href = 'Enter an address that starts with https://';
    setError(found);
    if (!found.label && !found.href) finish({ label: label.trim(), href: href.trim() });
  };
  const dialog = open ? (
    <Modal
      open
      title="Insert Button"
      subtitle="A link drawn as a button, for example to upload documents or pay."
      onClose={() => finish(null)}
      footer={
        <>
          <Button variant="secondary" onClick={() => finish(null)}>
            Cancel
          </Button>
          <Button type="submit" form="content-button-form">
            Insert Button
          </Button>
        </>
      }
    >
      <form id="content-button-form" className="flex flex-col gap-3" onSubmit={submit} noValidate>
        <Input
          label="Button text"
          required
          value={label}
          maxLength={60}
          onChange={(e) => setLabel(e.target.value)}
          {...(error.label ? { error: error.label } : {})}
        />
        <Input
          label="Link address"
          required
          type="url"
          value={href}
          onChange={(e) => setHref(e.target.value)}
          {...(error.href ? { error: error.href } : {})}
        />
        <p className="text-xs text-muted">
          https only. A merge field such as [Document Upload Link] goes in the text instead.
        </p>
      </form>
    </Modal>
  ) : null;
  return { ask, dialog };
}
