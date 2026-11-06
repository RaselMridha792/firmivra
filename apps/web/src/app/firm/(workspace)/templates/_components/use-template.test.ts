import { describe, expect, it } from 'vitest';
import { templateUseHref, blockedUseReason } from './use-template';

const id = '0199d2b0-6c00-7000-8000-000000000001';

describe('templateUseHref', () => {
  it('opens a Communications draft copied from an Email or SMS template', () => {
    expect(templateUseHref('EMAIL', id)).toBe(`/communications/new?channel=EMAIL&template=${id}`);
    expect(templateUseHref('SMS', id)).toBe(`/communications/new?channel=SMS&template=${id}`);
  });

  it('has nowhere to open for the other kinds', () => {
    expect(templateUseHref('DOCUMENT_REQUEST', id)).toBeNull();
    expect(templateUseHref('APPOINTMENT', id)).toBeNull();
  });
});

describe('blockedUseReason', () => {
  it('lets an active template be used', () => {
    expect(blockedUseReason('ACTIVE', false)).toBeNull();
  });

  it('says why a draft or an archived one cannot be (TP-F13, TP-F14)', () => {
    expect(blockedUseReason('DRAFT', true)).toMatch(/Activate it/);
    expect(blockedUseReason('DRAFT', false)).toMatch(/Ask an Owner or Admin/);
    expect(blockedUseReason('ARCHIVED', true)).toMatch(/archived template cannot be used/);
  });
});
