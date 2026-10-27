// IP-F06 (Octavia's Invoices & Payments review, Oct 27): the firm's due rules on its own calendar.
// An open invoice with a balance is Due Soon 7 to 2 days before its due date, Due Tomorrow the day
// before, Due Today on the day and Overdue from the next midnight; the list says the firm's today.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectOk, InvoiceList, nyDay, startInvoiceApp } from './invoice-setup.js';

let t: Awaited<ReturnType<typeof startInvoiceApp>>;
beforeAll(async () => {
  t = await startInvoiceApp('r56due');
});
afterAll(async () => {
  await t.app.close();
});

describe('due rules (IP-F06)', () => {
  it('give each open invoice its state on the firm’s calendar, and the list the firm’s today', async () => {
    const cases: [number, string | null][] = [
      [8, null],
      [7, 'DUE_SOON'],
      [2, 'DUE_SOON'],
      [1, 'DUE_TOMORROW'],
      [0, 'DUE_TODAY'],
      [-1, 'OVERDUE'],
    ];
    const made = new Map<string, string | null>();
    for (const [days, state] of cases) {
      const inv = await t.draft(t.ids.one, { status: 'OPEN', dueOn: nyDay(days) });
      expect(inv.dueState).toBe(state);
      made.set(inv.id, state);
    }
    // A draft due today has no state: only an open balance does.
    const draft = await t.draft(t.ids.one, { dueOn: nyDay(0) });
    expect(draft.dueState).toBeNull();

    const list = InvoiceList.parse(
      expectOk(await t.firm('get', '?limit=100', t.people.ownerA)).body,
    );
    expect(list.today).toBe(nyDay(0));
    for (const [id, state] of made) {
      const item = list.items.find((i) => i.id === id)!;
      expect(item.dueState).toBe(state);
      expect(item.overdue).toBe(state === 'OVERDUE');
    }
    expect(list.items.find((i) => i.id === draft.id)?.dueState).toBeNull();
  });
});
