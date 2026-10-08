'use client';

import { useEffect, useRef } from 'react';

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * The portal's top in the chosen colours: the portal theme (packages/ui README) turns the firm
 * colour variables on this element into its tokens. Blank or unfinished keeps Firmivra's default.
 */
export function BrandPreview({
  name,
  primary,
  accent,
  header,
  welcome,
}: {
  name: string;
  primary?: string | null;
  accent?: string | null;
  header?: string | null;
  welcome?: string | null;
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
      className="overflow-hidden rounded-card border border-border"
    >
      <p className="sr-only">Portal preview</p>
      <p data-testid="preview-bar" className="bg-navigation px-4 py-3 font-semibold text-on-action">
        {name}
      </p>
      <div className="flex flex-col items-start gap-2 bg-surface p-4">
        <p className="font-serif text-xl font-bold text-heading">
          {header || `Welcome to ${name}`}
        </p>
        {welcome ? <p className="whitespace-pre-wrap text-sm text-muted">{welcome}</p> : null}
        <span className="rounded-control bg-action px-4 py-2 text-sm font-medium text-on-action">
          Sign in
        </span>
      </div>
    </div>
  );
}
