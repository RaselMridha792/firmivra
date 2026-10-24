import { describe, expect, it } from 'vitest';
import { templateUseHref } from './use-template';

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
