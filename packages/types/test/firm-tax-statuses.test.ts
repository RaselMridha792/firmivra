import { describe, it, expect } from 'vitest';
import {
  CreateTaxStatusRequest,
  ListTaxStatusesQuery,
  OrderTaxStatusesRequest,
} from '../src/firm-tax-statuses.js';
describe('tax status input contracts', () => {
  it('parses booleans without treating the string false as true', () => {
    expect(ListTaxStatusesQuery.parse({ includeArchived: 'false' }).includeArchived).toBe(false);
    expect(ListTaxStatusesQuery.parse({ includeArchived: 'true' }).includeArchived).toBe(true);
    expect(ListTaxStatusesQuery.safeParse({ includeArchived: 'anything' }).success).toBe(false);
  });
  it('rejects identity injection, blank names and invalid permutations', () => {
    expect(CreateTaxStatusRequest.safeParse({ name: '   ' }).success).toBe(false);
    expect(CreateTaxStatusRequest.safeParse({ name: 'Open', businessId: 'forged' }).success).toBe(
      false,
    );
    expect(OrderTaxStatusesRequest.safeParse({ ids: [] }).success).toBe(false);
  });
});
