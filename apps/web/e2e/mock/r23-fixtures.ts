import type { Page, Route } from '@playwright/test';

// Synthetic clients for the firm's Clients screens (R23). api.clients has no mock module, so the
// specs answer /api/v1/business/clients themselves.
const id = (n: number) => `00000000-0000-4000-a000-${String(700 + n).padStart(12, '0')}`;

export const client = (n: number, fields: Record<string, unknown> = {}) => ({
  id: id(n),
  accountType: 'INDIVIDUAL',
  displayName: 'Maria Lopez',
  email: 'maria.lopez@example.test',
  phone: '+17705550142',
  assignedTo: { userId: id(90), name: 'Sam Staff' },
  portalStatus: 'ACTIVE',
  archivedAt: null,
  createdAt: '2026-10-02T14:10:00.000Z',
  ...fields,
});

export const CLIENTS = [
  client(1),
  client(2, {
    displayName: 'Brightline Bakery LLC',
    accountType: 'BUSINESS',
    email: 'owner@brightline.example.test',
    phone: '+14045550188',
    portalStatus: null,
  }),
  client(3, {
    displayName: 'James Carter',
    email: 'james.carter@example.test',
    phone: null,
    assignedTo: null,
    portalStatus: 'INVITED',
  }),
];

export const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Answers the list: `search` filters by name, and `cursor=2` is the second page. */
export async function routeClientList(page: Page, rows = CLIENTS) {
  await page.route('**/api/v1/business/clients?**', (route) => {
    const url = new URL(route.request().url());
    const search = url.searchParams.get('search')?.toLowerCase();
    if (url.searchParams.get('cursor') === '2') {
      return json(route, {
        items: [client(4, { displayName: 'Priya Natarajan' })],
        nextCursor: null,
      });
    }
    const items = search ? rows.filter((r) => r.displayName.toLowerCase().includes(search)) : rows;
    return json(route, { items, nextCursor: search ? null : '2' });
  });
}
