import type { ReactNode } from 'react';

/**
 * The band above a portal page's content (Octavia's Oct 8 portal mockups, Appointments and My
 * Services): a soft gradient, leaves on the right in place of the mockup's plant photo, the title
 * and sub-line on the left and a short script line on the right (hidden below 768 px). Nothing in
 * it is a firm's own branding, so every firm uses it.
 */
export function PortalPageHeader({
  title,
  subtitle,
  script = 'Your Goals. Our Support. Brighter Tomorrows.',
  titleAs: Title = 'h1',
}: {
  title: ReactNode;
  subtitle: ReactNode;
  /** The handwritten-style line on the right; its last sentence goes on a second line. */
  script?: string;
  /** "p" where each tab's own card holds the page's h1. */
  titleAs?: 'h1' | 'p';
}) {
  const sentences = script.split(/(?<=\.)\s+/);
  const last = sentences.length > 1 ? sentences.pop() : undefined;
  return (
    <header
      data-testid="portal-page-header"
      className="relative overflow-hidden rounded-card bg-linear-to-r from-folder-surface via-surface to-canvas px-6 py-6"
    >
      <Leaves />
      <div className="relative flex items-center gap-6">
        <div className="min-w-0 flex-1">
          <Title className="font-display text-4xl leading-tight font-bold text-heading md:text-5xl">
            {title}
          </Title>
          <p className="mt-1 text-lg text-text">{subtitle}</p>
        </div>
        <p
          aria-hidden
          className="hidden -rotate-6 text-right font-display text-2xl whitespace-nowrap text-heading italic xl:block"
        >
          {sentences.join(' ')}
          {last ? <span className="block pl-6">{last}</span> : null}
        </p>
      </div>
    </header>
  );
}

/** Soft, blurred leaves at the band's right edge. */
function Leaves() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 240 160"
      className="pointer-events-none absolute top-0 right-0 hidden h-full opacity-80 blur-xs md:block"
    >
      <g className="fill-success/40">
        <path d="M240 160 C 200 120 170 70 175 0 C 215 40 238 95 240 160 Z" />
        <path d="M240 160 C 190 140 140 110 110 50 C 170 60 215 100 240 160 Z" />
        <path d="M240 150 C 225 100 225 50 240 10 Z" />
      </g>
      <g className="fill-success/25">
        <path d="M240 160 C 180 160 120 150 80 110 C 140 100 200 120 240 160 Z" />
        <path d="M200 160 C 185 120 150 95 130 90 C 160 120 180 140 200 160 Z" />
      </g>
    </svg>
  );
}
