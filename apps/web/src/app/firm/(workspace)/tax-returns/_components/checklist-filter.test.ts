import type { FirmDocumentRequest } from '@firmivra/types';
import { describe, expect, it } from 'vitest';
import { checklistRequests } from './checklist-filter';

// ACC-DOC (R61's live check): the return's Document Checklist lists this return's requests only.
const tax = { id: '0199c1e1-0000-7000-8000-0000000000e1', title: 'Personal Tax (fake)' };
const payroll = { id: '0199c1e1-0000-7000-8000-0000000000e2', title: 'Payroll (fake)' };
const ret = '0199c1e1-0000-7000-8000-000000000001';
const other = '0199c1e1-0000-7000-8000-000000000002';
const request = (title: string, over: Partial<FirmDocumentRequest>) =>
  ({
    id: `0199c1e1-0000-7000-8000-${String(title.length).padStart(12, '0')}`,
    title,
    status: 'REQUESTED',
    service: tax,
    taxYear: null,
    taxReturn: null,
    ...over,
  }) as FirmDocumentRequest;

describe('the Document Checklist of a return (ACC-DOC)', () => {
  const all = [
    request('W-2 for this return', { taxReturn: { id: ret, label: '2021 1040' }, taxYear: 2021 }),
    request('1099 for the same year and service', { taxYear: 2021 }),
    request('W-2 for another return', {
      taxReturn: { id: other, label: '2022 1040' },
      taxYear: 2022,
    }),
    request('Last year receipts', { taxYear: 2020 }),
    request('Q4 payroll register', { service: payroll, taxYear: null }),
    request('Payroll register for 2021', { service: payroll, taxYear: 2021 }),
    request('Cancelled W-9', { taxReturn: { id: ret, label: '2021 1040' }, status: 'CANCELLED' }),
  ];

  it("lists this return's requests and its year's unlinked ones of the same service", () => {
    expect(
      checklistRequests(all, { id: ret, taxYear: 2021, engagement: tax }).map((r) => r.title),
    ).toEqual(['W-2 for this return', '1099 for the same year and service']);
  });

  it("with no service, only the requests sent for this return, never another service's", () => {
    expect(
      checklistRequests(all, { id: ret, taxYear: 2021, engagement: null }).map((r) => r.title),
    ).toEqual(['W-2 for this return']);
    // None sent for it: the checklist is empty (its usual empty state).
    expect(
      checklistRequests(
        all.filter((r) => r.taxReturn?.id !== ret),
        { id: ret, taxYear: 2021, engagement: null },
      ),
    ).toEqual([]);
  });
});
