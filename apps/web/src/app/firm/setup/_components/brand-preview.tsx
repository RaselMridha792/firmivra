'use client';

import { Button } from '@firmivra/ui';
import { Monitor, Smartphone, Tablet } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';

const HEX = /^#[0-9a-f]{6}$/i;

type Device = 'desktop' | 'tablet' | 'phone';
const DEVICES: { id: Device; label: string; icon: typeof Monitor }[] = [
  { id: 'desktop', label: 'Desktop preview', icon: Monitor },
  { id: 'tablet', label: 'Tablet preview', icon: Tablet },
  { id: 'phone', label: 'Phone preview', icon: Smartphone },
];
const WIDTH: Record<Device, string> = {
  desktop: 'w-full',
  tablet: 'mx-auto w-full max-w-md',
  phone: 'mx-auto w-full max-w-xs',
};

/**
 * The portal's landing page in short, laid out like docs/mockups/client-portal/Client portal
 * landing page.png and in the chosen colours: the portal theme (packages/ui README) turns the firm
 * colour variables on this element into its tokens. Blank or unfinished keeps Firmivra's default.
 */
export function BrandPreview({
  name,
  logoUrl,
  primary,
  accent,
  header,
  welcome,
  signUp = true,
  signInLabel = null,
  signUpLabel = null,
  devices = false,
}: {
  name: string;
  /** The firm's logo; none keeps the name alone. */
  logoUrl?: string | null;
  primary?: string | null;
  accent?: string | null;
  header?: string | null;
  welcome?: string | null;
  /** The portal shows Create an account only while client sign-up is on. */
  signUp?: boolean;
  /** CP-1g: the firm's button text; null shows the default words. */
  signInLabel?: string | null;
  signUpLabel?: string | null;
  /** CP-1g: desktop, tablet and phone widths for the preview. */
  devices?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [device, setDevice] = useState<Device>('desktop');
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
    <div className="flex flex-col gap-2">
      {devices ? (
        <div role="group" aria-label="Preview size" className="flex gap-2 self-end">
          {DEVICES.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              variant={device === id ? 'primary' : 'secondary'}
              className="min-h-9 px-3"
              aria-label={label}
              aria-pressed={device === id}
              onClick={() => setDevice(id)}
            >
              <Icon aria-hidden className="size-4" />
            </Button>
          ))}
        </div>
      ) : null}
      <div
        ref={ref}
        data-theme="portal"
        data-testid="brand-preview"
        data-device={device}
        className={`overflow-hidden rounded-card border border-border bg-surface ${WIDTH[device]}`}
      >
        <p className="sr-only">Portal preview</p>
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          {logoUrl ? (
            <Image
              unoptimized
              src={logoUrl}
              alt=""
              width={96}
              height={32}
              className="h-auto max-h-8 w-auto"
            />
          ) : null}
          <p className="font-bold text-heading">{name}</p>
        </div>
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
              {signInLabel ?? 'Sign in'}
            </span>
            {signUp ? (
              <span className="rounded-control border border-action px-4 py-2 text-sm font-semibold text-action">
                {signUpLabel ?? 'Create an account'}
              </span>
            ) : null}
          </div>
        </div>
        <p data-testid="preview-bar" className="bg-navigation px-5 py-3 text-sm text-on-action">
          {name}
        </p>
      </div>
    </div>
  );
}
