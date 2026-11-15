// Tax Returns Review 2, F10 (R60, Nov 15; migration r60_request_tax_return, the lead's approval): a
// document request made from a tax return names its tax year and that return, which must be the
// same client's; a return a request names is never deleted under it. Runs as the app role.
import { beforeAll, describe, expect, inject, it } from 'vitest';
import {
  connect,
  createEngagement,
  createTwoFirms,
  failure,
  type TwoFirms,
} from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
let engagementId = '';
let returnId = '';
let otherClientReturnId = '';
const A = () => db.forBusiness(f.firmA);

const request = (data: Record<string, unknown>) =>
  A().documentRequest.create({
    data: {
      businessId: f.firmA,
      clientId: f.clientA,
      engagementId,
      title: 'Prior-year return (fake)',
      ...data,
    },
  });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r60rtr');
  engagementId = await createEngagement(owner, f.firmA, f.clientA, 'ANNUAL_TAX');
  returnId = (
    await A().taxReturn.create({
      data: { businessId: f.firmA, clientId: f.clientA, taxYear: 2025, filingType: 'INDIVIDUAL' },
    })
  ).id;
  const other = await A().client.create({
    data: { businessId: f.firmA, displayName: 'Another client (fake)' },
  });
  otherClientReturnId = (
    await A().taxReturn.create({
      data: { businessId: f.firmA, clientId: other.id, taxYear: 2025, filingType: 'INDIVIDUAL' },
    })
  ).id;
});

describe('a request made from a tax return', () => {
  it('keeps its year and return; anywhere else both stay empty', async () => {
    const fromReturn = await request({ taxYear: 2025, taxReturnId: returnId });
    expect([fromReturn.taxYear, fromReturn.taxReturnId]).toEqual([2025, returnId]);
    const elsewhere = await request({});
    expect([elsewhere.taxYear, elsewhere.taxReturnId]).toEqual([null, null]);
    // A year alone is fine (a request about a year, not a return).
    await expect(request({ taxYear: 2024 })).resolves.toMatchObject({ taxYear: 2024 });
  });

  it("names only the same client's return, always with its year, a real tax year", async () => {
    expect(await failure(request({ taxYear: 2025, taxReturnId: otherClientReturnId }))).toMatch(
      /foreign key/i,
    );
    expect(await failure(request({ taxReturnId: returnId }))).toMatch(
      /document_requests_tax_return/,
    );
    expect(await failure(request({ taxYear: 1890 }))).toMatch(/document_requests_tax_return/);
  });

  it('keeps the return it names: the return cannot be deleted under the request', async () => {
    const r = (
      await A().taxReturn.create({
        data: { businessId: f.firmA, clientId: f.clientA, taxYear: 2023, filingType: 'INDIVIDUAL' },
      })
    ).id;
    await request({ taxYear: 2023, taxReturnId: r });
    expect(await failure(A().taxReturn.delete({ where: { id: r } }))).toMatch(
      /foreign key|violates|restrict/i,
    );
  });
});
