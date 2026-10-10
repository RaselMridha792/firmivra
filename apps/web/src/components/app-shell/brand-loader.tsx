import { BrandLockup } from './brand-lockup';

/**
 * Firmivra's loader for the signed-in Super Admin and firm sites: just the whole lockup, fading in
 * and out (still for people who turn motion off); "Loading…" is for screen readers only.
 * `fullScreen` fills the window (the sign-in check, before the shell is there); otherwise it fills
 * the page area inside the shell. Not for the client portal, which shows the firm's own branding.
 */
export function BrandLoader({
  subtitle,
  fullScreen = false,
}: {
  /** The site's tagline under the wordmark, as in its sidebar: "Super Admin Portal", "Firm workspace". */
  subtitle: string;
  fullScreen?: boolean;
}) {
  return (
    <div
      role="status"
      data-testid="brand-loader"
      className={`flex items-center justify-center ${fullScreen ? 'min-h-screen' : 'min-h-96'}`}
    >
      <div aria-hidden className="animate-pulse motion-reduce:animate-none">
        <BrandLockup subtitle={subtitle} />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
