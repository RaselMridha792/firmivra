import { describe, expect, it } from 'vitest';
import { CreatePortalCustomTab, UpdatePortalCustomTab } from '../../src/index.js';

// CP-5d, CP-5e: a custom tab's contract. Synthetic ids only.
const tag = '0199b6a1-0000-7000-8000-0000000000a1';
const client = '0199b6a1-0000-7000-8000-0000000000c1';

describe('CreatePortalCustomTab', () => {
  it('defaults to every business client, with no targets', () => {
    expect(CreatePortalCustomTab.parse({ label: ' Payroll files ', module: 'DOCUMENTS' })).toEqual({
      label: 'Payroll files',
      module: 'DOCUMENTS',
      audience: 'ALL',
      tagIds: [],
      clientIds: [],
    });
  });

  it('takes a tag audience with tags, a client audience with clients, and either with both', () => {
    const base = { label: 'Resources', module: 'BUSINESS_RESOURCES' };
    expect(
      CreatePortalCustomTab.safeParse({ ...base, audience: 'TAGS', tagIds: [tag] }).success,
    ).toBe(true);
    expect(
      CreatePortalCustomTab.safeParse({ ...base, audience: 'CLIENTS', clientIds: [client] })
        .success,
    ).toBe(true);
    const both = { tagIds: [tag], clientIds: [client] };
    for (const audience of ['TAGS', 'CLIENTS'])
      expect(CreatePortalCustomTab.safeParse({ ...base, audience, ...both }).success).toBe(true);
  });

  it('refuses targets that disagree with the audience, a built-in module, or another field', () => {
    const base = { label: 'Resources', module: 'DOCUMENTS' };
    for (const bad of [
      { ...base, audience: 'TAGS' },
      { ...base, audience: 'CLIENTS' },
      { ...base, audience: 'ALL', tagIds: [tag] },
      { ...base, audience: 'ALL', clientIds: [client] },
      { ...base, audience: 'TAGS', clientIds: [client] },
      { ...base, audience: 'CLIENTS', tagIds: [tag] },
      { ...base, module: 'MESSAGES' },
      { ...base, label: '' },
      { ...base, label: 'x'.repeat(41) },
      { ...base, label: 'Two\nlines' },
      { ...base, businessId: client },
    ]) {
      expect(CreatePortalCustomTab.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('UpdatePortalCustomTab', () => {
  it('changes one thing at a time, or the audience with its targets', () => {
    expect(UpdatePortalCustomTab.safeParse({ enabled: false }).success).toBe(true);
    expect(UpdatePortalCustomTab.safeParse({ audience: 'ALL' }).success).toBe(true);
    expect(UpdatePortalCustomTab.safeParse({ audience: 'TAGS', tagIds: [tag] }).success).toBe(true);
  });

  it('refuses an empty change, a module change, and an audience without its targets', () => {
    for (const bad of [
      {},
      { module: 'BUSINESS_RESOURCES' },
      { audience: 'CLIENTS' },
      { audience: 'ALL', clientIds: [client] },
    ]) {
      expect(UpdatePortalCustomTab.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
