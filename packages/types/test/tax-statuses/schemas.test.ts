import { describe, it, expect } from 'vitest';
import {
  CreateTaxStatusRequest,
  ListTaxStatusesQuery,
  OrderTaxStatusesRequest,
  RenameTaxStatusRequest,
} from '../../src/index.js';

describe('tax status input contracts', () => {
  it('parses booleans without treating the string false as true', () => {
    expect(ListTaxStatusesQuery.parse({ includeArchived: 'false' }).includeArchived).toBe(false);
    expect(ListTaxStatusesQuery.parse({ includeArchived: 'true' }).includeArchived).toBe(true);
    expect(ListTaxStatusesQuery.parse({}).includeArchived).toBe(false);
    expect(ListTaxStatusesQuery.safeParse({ includeArchived: 'anything' }).success).toBe(false);
  });

  it('rejects identity injection, blank names and invalid permutations', () => {
    expect(CreateTaxStatusRequest.safeParse({ name: '   ' }).success).toBe(false);
    expect(CreateTaxStatusRequest.safeParse({ name: 'Open', businessId: 'forged' }).success).toBe(
      false,
    );
    expect(OrderTaxStatusesRequest.safeParse({ ids: [] }).success).toBe(false);
    const id = '0199b6a0-0000-7000-8000-000000000001';
    expect(OrderTaxStatusesRequest.safeParse({ ids: [id, id] }).success).toBe(false);
  });

  it('trims names and limits them to 120 characters', () => {
    expect(RenameTaxStatusRequest.parse({ name: '  Filed  ' }).name).toBe('Filed');
    expect(RenameTaxStatusRequest.safeParse({ name: 'x'.repeat(121) }).success).toBe(false);
  });
});
