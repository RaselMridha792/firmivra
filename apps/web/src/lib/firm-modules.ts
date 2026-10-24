// Server-safe icons: this file is read by the module page (a server component) and the sidebar.
import { Envelope, Globe } from '@phosphor-icons/react/ssr';
import type { Icon } from '@phosphor-icons/react';

/** A firm workspace module whose page is not built yet. */
export interface FirmModule {
  slug: string;
  label: string;
  icon: Icon;
}

/**
 * The sidebar's modules that have no page yet, in the design's order. Each one opens the shared
 * /modules/<slug> page. When a module is built, remove it here and point its sidebar item
 * (`firmMenu` in the firm layout) to the real page.
 */
export const FIRM_MODULES: readonly FirmModule[] = [
  // R34: the Documents page itself is built, and Upload Document and Document Requests (R56,
  // `/documents/upload`, `/documents/requests`). Create Document Request still opens this one.
  { slug: 'document-request-create', label: 'Create Document Request', icon: Envelope },
  { slug: 'client-portal', label: 'Client Portal', icon: Globe },
];

export function findModule(slug: string): FirmModule | undefined {
  return FIRM_MODULES.find((m) => m.slug === slug);
}

export function moduleHref(slug: string): string {
  return `/modules/${slug}`;
}
