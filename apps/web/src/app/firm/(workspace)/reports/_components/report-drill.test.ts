import { describe, expect, it } from 'vitest';
import { cellLink, ownRecord, packView, recordHref, viewFrom } from './report-drill';

// RP-F17: rows open their records; Back finds the report as it was.
const INV = '0199b6a1-0000-7000-8000-0000000000a1';
const CLI = '0199b6a1-0000-7000-8000-000000000001';
const PAY = '0199b6a1-0000-7000-8000-0000000000b1';

describe('report drill-down', () => {
  it('opens each record on its page; a payment through its invoice', () => {
    expect(recordHref({ kind: 'CLIENT', id: CLI })).toBe(`/clients/${CLI}`);
    expect(recordHref({ kind: 'INVOICE', id: INV })).toBe(`/invoices/${INV}`);
    expect(recordHref({ kind: 'RETURN', id: INV })).toBe(`/tax-returns/${INV}`);
    expect(recordHref({ kind: 'PAYMENT', id: PAY })).toBeNull();
    const payment = [
      { kind: 'PAYMENT' as const, id: PAY },
      { kind: 'INVOICE' as const, id: INV },
      { kind: 'CLIENT' as const, id: CLI },
    ];
    expect(ownRecord(payment)).toEqual({ kind: 'INVOICE', id: INV });
  });

  it('the first column opens the row, a client column its client, others nothing', () => {
    const links = [
      { kind: 'INVOICE' as const, id: INV },
      { kind: 'CLIENT' as const, id: CLI },
    ];
    expect(cellLink('number', true, links)).toEqual({ kind: 'INVOICE', id: INV });
    expect(cellLink('client', false, links)).toEqual({ kind: 'CLIENT', id: CLI });
    expect(cellLink('clientName', false, links)).toEqual({ kind: 'CLIENT', id: CLI });
    expect(cellLink('total', false, links)).toBeNull();
    expect(cellLink('number', true, [])).toBeNull();
  });

  it('keeps the view in the address and reads back only what is valid', () => {
    const view = {
      search: 'Riley',
      page: 3,
      sort: { id: 'total', descending: true },
      hidden: ['tax'],
      extra: {
        rows: [{ field: 'total', op: 'GREATER_THAN', value: '500', to: '', values: [] }],
        conditions: [{ field: 'total', op: 'GREATER_THAN' as const, value: 50_000 }],
      },
    };
    expect(viewFrom(packView(view))).toEqual(view);
    expect(viewFrom(null)).toBeNull();
    expect(viewFrom('not base64!')).toBeNull();
    expect(viewFrom(packView({ ...view, page: -2 } as never))?.page).toBe(1);
  });
});
