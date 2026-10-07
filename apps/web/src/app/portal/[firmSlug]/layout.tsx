import type { ReactNode } from 'react';

/**
 * Every page of one firm's portal (/{firm}/...). The firm's colours are the tokens
 * --color-firm-primary and --color-firm-accent, with defaults in packages/ui. Once R3's public
 * GET /api/v1/portal/{slug}/info is on main, this layout loads the firm, sets those two colours
 * from it and shows not-found for an unknown slug. Nahid polishes it (N01).
 */
export default function FirmPortalLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-canvas">{children}</div>;
}
