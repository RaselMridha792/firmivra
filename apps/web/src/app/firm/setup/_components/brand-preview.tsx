'use client';

import { useEffect, useRef } from 'react';

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * The portal's landing page in short, laid out like docs/mockups/client-portal/Client portal
 * landing page.png and in the chosen colours: the portal theme (packages/ui README) turns the firm
 * colour variables on this element into its tokens. Blank or unfinished keeps Firmivra's default.
 */
export function BrandPreview({
  name,
  primary,
  accent,
  header,
  welcome,
  signUp = true,
}: {
  name: string;
  primary?: string | null;
  accent?: string | null;
  header?: string | null;
  welcome?: string | null;
  /** The portal shows Create an account only while client sign-up is on. */
  signUp?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const style = ref.current?.style;
    if (!style) return;
    const colours = { '--color-firm-primary': primary, '--color-firm-accent': accent };
    for (const [property, value] of Object.entries(colours)) {
      if (value && HEX.test(value)) style.setProperty(property, value);
      else style.removeProperty(property);
    }
  }, [primary, accent]);

  return (
    <div
      ref={ref}
      data-theme="portal"
      data-testid="brand-preview"
      className="overflow-hidden rounded-card border border-border bg-surface"
    >
      <p className="sr-only">Portal preview</p>
      <p className="border-b border-border px-5 py-3 font-bold text-heading">{name}</p>
      <div className="flex flex-col items-start gap-3 bg-canvas px-5 py-6">
        <p className="text-xs font-semibold uppercase tracking-eyebrow text-accent">
          Client portal
        </p>
        <p className="font-display text-2xl font-bold text-heading">
          {header || `Welcome to ${name}`}
        </p>
        {welcome ? <p className="whitespace-pre-wrap text-sm text-muted">{welcome}</p> : null}
        <div className="flex flex-wrap gap-3">
          <span className="rounded-control bg-action px-4 py-2 text-sm font-semibold text-on-action">
            Sign in
          </span>
          {signUp ? (
            <span className="rounded-control border border-action px-4 py-2 text-sm font-semibold text-action">
              Create an account
            </span>
          ) : null}
        </div>
      </div>
      <p data-testid="preview-bar" className="bg-navigation px-5 py-3 text-sm text-on-action">
        {name}
      </p>
    </div>
  );
}
