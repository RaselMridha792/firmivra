// A dashboard card's drill-down (Octavia's K2): the card adds `?back=dashboard` to the page it
// opens, and that page shows Back to Dashboard (components/back-to-dashboard.tsx). Plain values,
// so server pages read them too.

/** What a dashboard card adds to the page it opens. */
export const FROM_DASHBOARD = 'back=dashboard';

/** True when the page's `?back=` says a dashboard card opened it. */
export const openedFromDashboard = (back: unknown) => back === 'dashboard';

const PLACE_KEY = 'fv-dashboard-place';
const PLACE = /^\/(?:\?[A-Za-z0-9=&_-]{0,300})?$/;

/**
 * Dashboard Review 2 (K2, V9): the dashboard's address on this tab (its periods), which Back to
 * Dashboard returns to. Only the dashboard's own path is ever kept or followed.
 */
export function rememberDashboard(address: string): void {
  if (!PLACE.test(address)) return;
  try {
    sessionStorage.setItem(PLACE_KEY, address);
  } catch {
    // Storage blocked: Back to Dashboard opens the default periods.
  }
}

/** The dashboard's last address on this tab, `/` when none is kept. */
export function dashboardPlace(): string {
  try {
    const kept = sessionStorage.getItem(PLACE_KEY);
    return kept && PLACE.test(kept) ? kept : '/';
  } catch {
    return '/';
  }
}
