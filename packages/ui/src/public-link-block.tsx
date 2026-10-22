'use client';

import { Check, Copy, LinkSimple, WarningCircle } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from './button';

export interface PublicLinkBlockProps {
  /** The stable public link; null while it loads or when the item has none yet. */
  url: string | null;
  /** The iframe code for the firm's own website; shown with `url`. */
  embedCode: string | null;
  /** The heading: "Booking Link", "Form Link", "Package Link". */
  title?: string;
  /** The link's button: "Copy Booking Link". */
  copyLinkLabel?: string;
  copyEmbedLabel?: string;
  /** A warning above the fields, when the item takes no new public use (draft, archived…). */
  notice?: string;
  /** Shown instead of the fields while `url` is null. */
  emptyText?: string;
  /** Copies text; the browser clipboard by default. */
  copy?: (text: string) => Promise<void>;
}

type Field = 'link' | 'embed';

const field =
  'min-w-0 flex-1 rounded-control border border-border bg-subtle px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-action/25';

/**
 * The shared "Copy link / Copy embed code" block (Octavia's review of Oct 20): a public item's
 * stable link and its embed code, each with a Copy button, for the firm's website. Used by
 * intake forms, appointment types and service packages, each with its own labels. When copying
 * is refused, the text is selected so it can be copied by hand.
 */
export function PublicLinkBlock({
  url,
  embedCode,
  title = 'Public Link',
  copyLinkLabel = 'Copy Link',
  copyEmbedLabel = 'Copy Embed Code',
  notice,
  emptyText = 'The link appears here once it is available.',
  copy = (text) => navigator.clipboard.writeText(text),
}: PublicLinkBlockProps) {
  const id = useId();
  const linkRef = useRef<HTMLInputElement>(null);
  const embedRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState<Field | null>(null);
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copyField = async (which: Field) => {
    const text = which === 'link' ? url : embedCode;
    if (!text) return;
    try {
      await copy(text);
      setCopied(which);
      setStatus(which === 'link' ? 'Link copied.' : 'Embed code copied.');
    } catch {
      setCopied(null);
      (which === 'link' ? linkRef.current : embedRef.current)?.select();
      setStatus('Copying was blocked. The text is selected: press Ctrl+C (⌘C on a Mac).');
    }
  };

  const button = (which: Field, label: string) => (
    <Button
      variant="secondary"
      className="shrink-0 sm:min-w-48"
      onClick={() => void copyField(which)}
    >
      {copied === which ? (
        <Check aria-hidden weight="bold" className="size-4 text-success" />
      ) : (
        <Copy aria-hidden weight="bold" className="size-4" />
      )}
      {copied === which ? 'Copied' : label}
    </Button>
  );

  return (
    <section
      aria-labelledby={`${id}-title`}
      data-testid="public-link"
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-divider bg-surface p-4"
    >
      <h3
        id={`${id}-title`}
        className="flex items-center gap-2 text-base font-semibold text-heading"
      >
        <LinkSimple aria-hidden weight="fill" className="size-5 text-action" />
        {title}
      </h3>
      {notice ? (
        <p
          data-testid="public-link-notice"
          className="flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-sm text-text"
        >
          <WarningCircle aria-hidden weight="fill" className="mt-0.5 size-5 shrink-0 text-gold" />
          {notice}
        </p>
      ) : null}
      {url ? (
        <>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={`${id}-link`} className="text-sm font-semibold text-heading">
              Link
            </label>
            <div className="flex min-w-0 gap-2 max-sm:flex-col">
              <input
                ref={linkRef}
                id={`${id}-link`}
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className={field}
              />
              {button('link', copyLinkLabel)}
            </div>
          </div>
          {embedCode ? (
            <div className="flex min-w-0 flex-col gap-1.5">
              <label htmlFor={`${id}-embed`} className="text-sm font-semibold text-heading">
                Embed code
              </label>
              <div className="flex min-w-0 gap-2 max-sm:flex-col sm:items-start">
                <textarea
                  ref={embedRef}
                  id={`${id}-embed`}
                  readOnly
                  rows={4}
                  value={embedCode}
                  onFocus={(e) => e.currentTarget.select()}
                  className={`${field} resize-none font-mono text-xs`}
                />
                {button('embed', copyEmbedLabel)}
              </div>
              <p className="text-xs text-muted">
                Paste it into a page of your website where it should appear.
              </p>
            </div>
          ) : null}
        </>
      ) : (
        <p data-testid="public-link-empty" className="rounded-lg bg-subtle p-3 text-sm text-muted">
          {emptyText}
        </p>
      )}
      <p id={`${id}-status`} role="status" className={status ? 'text-sm text-text' : 'sr-only'}>
        {status}
      </p>
    </section>
  );
}
