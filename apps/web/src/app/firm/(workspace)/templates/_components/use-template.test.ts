import { describe, expect, it } from 'vitest';
import { blockedUseReason, templateUse } from './use-template';

const id = '0199d2b0-6c00-7000-8000-000000000001';
const linked = '0199d2b0-6c00-7000-8000-000000000002';
const row = (kind: Parameters<typeof templateUse>[0]['kind'], over = {}) => ({
  id,
  kind,
  status: 'ACTIVE' as const,
  linkedTemplateId: null,
  ...over,
});

describe('templateUse', () => {
  it('opens a Communications draft copied from an Email or SMS template', () => {
    expect(templateUse(row('EMAIL'), true)).toEqual({
      href: `/communications/new?channel=EMAIL&template=${id}`,
    });
    expect(templateUse(row('SMS'), true)).toEqual({
      href: `/communications/new?channel=SMS&template=${id}`,
    });
  });

  it('starts a task, a request or a form from the template it stands for (TP-F08)', () => {
    const on = { linkedTemplateId: linked };
    expect(templateUse(row('TASK', on), true)).toEqual({ href: `/tasks/new?template=${linked}` });
    expect(templateUse(row('DOCUMENT_REQUEST', on), true)).toEqual({
      href: `/documents/requests/new?template=${linked}`,
    });
    expect(templateUse(row('INTAKE_ORGANIZER', on), true)).toEqual({
      href: `/intake-forms/send?formId=${linked}`,
    });
  });

  it('says what is missing when nothing is chosen, and why Tax Workflow and Bookkeeping wait', () => {
    expect(templateUse(row('TASK'), true)).toEqual({
      reason: 'Choose the task template it stands for under Structure in the editor first.',
    });
    expect(templateUse(row('TAX_WORKFLOW'), true)).toEqual({
      reason: expect.stringMatching(/^Tax Returns cannot start from a template yet/) as string,
    });
    expect(templateUse(row('BOOKKEEPING'), true)).toEqual({
      reason: expect.stringMatching(/^Bookkeeping cannot start from a template yet/) as string,
    });
  });

  it('only an active template is used; the other kinds have no Use here', () => {
    expect(templateUse(row('TASK', { status: 'DRAFT', linkedTemplateId: linked }), false)).toEqual({
      reason: 'A draft cannot be used yet. Ask an Owner or Admin to activate it.',
    });
    expect(templateUse(row('APPOINTMENT'), true)).toBeNull();
    expect(templateUse(row('PORTAL_MESSAGE'), true)).toBeNull();
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
