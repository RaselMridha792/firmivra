import { BrandLockup } from './brand-lockup';

/**
 * Firmivra's loader for the signed-in Super Admin and firm sites: the whole lockup fades in and
 * out, and keeps still for people who turn motion off. `fullScreen` fills the window (the sign-in
 * check, before the shell is there); otherwise it fills the page area inside the shell. Not for
 * the client portal, which shows the firm's own branding.
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
      className={`flex flex-col items-center justify-center gap-4 ${fullScreen ? 'min-h-screen' : 'min-h-96'}`}
    >
      {/* Screen readers hear only "Loading…". */}
      <div aria-hidden className="animate-pulse motion-reduce:animate-none">
        <BrandLockup subtitle={subtitle} />
      </div>
      <p className="text-sm text-muted">Loading…</p>
    </div>
  );
}
