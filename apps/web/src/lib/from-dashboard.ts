// A dashboard card's drill-down (Octavia's K2): the card adds `?back=dashboard` to the page it
// opens, and that page shows Back to Dashboard (components/back-to-dashboard.tsx). Plain values,
// so server pages read them too.

/** What a dashboard card adds to the page it opens. */
export const FROM_DASHBOARD = 'back=dashboard';

/** True when the page's `?back=` says a dashboard card opened it. */
export const openedFromDashboard = (back: unknown) => back === 'dashboard';
