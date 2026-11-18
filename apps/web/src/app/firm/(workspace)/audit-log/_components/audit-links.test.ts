import { describe, expect, it } from 'vitest';
import { recordHref } from './audit-links';

const id = '0199B6A1-0000-7000-8000-000000000001';
const entity = (type: string, extra: { id?: string | null; deleted?: boolean } = {}) => ({
  type,
  id: extra.id === undefined ? id : extra.id,
  name: 'Fake',
  deleted: extra.deleted ?? false,
});

// Audit Log Review 2, M01b: a record opens on its own page, which checks the viewer's access.
describe('audit record links', () => {
  it('opens each record type on its workspace page', () => {
    expect(recordHref(entity('client'))).toBe(`/clients/${id.toLowerCase()}`);
    expect(recordHref(entity('compliance_deadline'))).toBe(`/compliance/${id.toLowerCase()}`);
    expect(recordHref(entity('appointment'))).toBe(`/calendar/${id.toLowerCase()}`);
    expect(recordHref(entity('membership'))).toBe(`/team/${id.toLowerCase()}`);
  });

  it('has no link for a gone record, a type without a page, or an id that is not a UUID', () => {
    expect(recordHref(entity('client', { deleted: true }))).toBeNull();
    expect(recordHref(entity('rtest_thing'))).toBeNull();
    expect(recordHref(entity('client', { id: 'thing-1' }))).toBeNull();
    expect(recordHref(entity('client', { id: null }))).toBeNull();
  });
});
