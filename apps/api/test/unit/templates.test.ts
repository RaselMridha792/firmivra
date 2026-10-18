// R55: the Templates module's logic that needs no database: the starter templates, what a body
// is cleaned to, who may see and change a template, and the render service (values are data,
// fields no value fills are listed, the result is sanitized after rendering).
import { describe, expect, it } from 'vitest';
import type { Env } from '../../src/config/env.js';
import { fieldsIn, builtIn } from '../../src/templates/merge-fields.js';
import { STARTERS } from '../../src/templates/template-starters.js';
import { TemplateRenderService } from '../../src/templates/template-render.service.js';
import { cleanBody } from '../../src/templates/templates.service.js';
import {
  AUTOMATION_KINDS,
  PLAIN_KINDS,
  SUBJECT_KINDS,
  canEdit,
  canShare,
  visibleTo,
} from '../../src/templates/templates.common.js';

const values = (o: Record<string, string>) =>
  new Map(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));

describe('the starter templates', () => {
  it('are 48, each with a key the database accepts and a name once in its kind', () => {
    expect(STARTERS).toHaveLength(48);
    for (const s of STARTERS) expect(s.key).toMatch(/^[a-z0-9][a-z0-9_.-]{0,79}$/);
    expect(new Set(STARTERS.map((s) => s.key)).size).toBe(48);
    const names = STARTERS.map((s) => `${s.kind}:${s.name.toLowerCase()}`);
    expect(new Set(names).size).toBe(names.length);
    for (const s of STARTERS) {
      expect(s.name.length).toBeLessThanOrEqual(200);
      expect(s.category.length).toBeLessThanOrEqual(100);
      expect(s.body.length).toBeLessThanOrEqual(50_000);
    }
  });

  it('use only built-in merge fields, have a subject where the kind needs one, and keep plain kinds plain', () => {
    for (const s of STARTERS) {
      for (const field of fieldsIn(s.subject, s.body)) {
        expect(builtIn(field), `${s.key}: [${field}]`).toBeDefined();
      }
      if (SUBJECT_KINDS.has(s.kind)) expect(s.subject, s.key).toBeTruthy();
      if (PLAIN_KINDS.has(s.kind)) expect(s.body, s.key).not.toMatch(/[<>]/);
      // Text that goes through the same cleaning as a saved body comes out the same.
      expect(cleanBody(s.kind, s.body), s.key).toBe(
        PLAIN_KINDS.has(s.kind) ? s.body : cleanBody(s.kind, cleanBody(s.kind, s.body)),
      );
    }
  });

  it('cover every kind', () => {
    expect(new Set(STARTERS.map((s) => s.kind)).size).toBe(16);
  });
});

describe('cleanBody', () => {
  it('removes scripts and markup from what the kind keeps as rich text or plain text', () => {
    expect(cleanBody('EMAIL', '<p onclick="x()">Hi</p><script>alert(1)</script>')).toBe(
      '<p>Hi</p>',
    );
    expect(cleanBody('SMS', '<b>Hi</b> there')).toBe('Hi there');
    expect(cleanBody('TASK', 'One\nTwo')).toBe('One\nTwo');
  });
});

describe('who sees and changes a template', () => {
  const staff = { userId: 'u1', role: 'STAFF' as const };
  const admin = { userId: 'u2', role: 'ADMIN' as const };

  it('Owner and Admin see every template; others their own, the team’s and those shared with them', () => {
    expect(visibleTo(admin)).toEqual({});
    expect(visibleTo({ userId: 'u3', role: 'OWNER' })).toEqual({});
    expect(visibleTo(staff)).toEqual({
      OR: [
        { ownerUserId: 'u1' },
        { access: 'TEAM' },
        { access: 'SELECTED', shares: { some: { userId: 'u1' } } },
      ],
    });
  });

  it('changing: the owner, Owner or Admin, or anyone for a team template; sharing: not the latter', () => {
    const mine = { ownerUserId: 'u1', access: 'PRIVATE' };
    const theirs = { ownerUserId: 'u9', access: 'SELECTED' };
    const team = { ownerUserId: 'u9', access: 'TEAM' };
    expect(canEdit(mine, staff)).toBe(true);
    expect(canEdit(theirs, staff)).toBe(false);
    expect(canEdit(team, staff)).toBe(true);
    expect(canEdit(theirs, admin)).toBe(true);
    expect(canShare(mine, staff)).toBe(true);
    expect(canShare(team, staff)).toBe(false);
    expect(canShare(team, admin)).toBe(true);
  });

  it('automations support some kinds only', () => {
    expect(AUTOMATION_KINDS.has('EMAIL')).toBe(true);
    for (const kind of [
      'INTAKE_ORGANIZER',
      'ENGAGEMENT_AGREEMENT',
      'LETTER_NOTICE',
      'ANNOUNCEMENT',
    ] as const) {
      expect(AUTOMATION_KINDS.has(kind)).toBe(false);
    }
  });
});

describe('TemplateRenderService.render', () => {
  const service = new TemplateRenderService({ PORTAL_BASE_URL: 'https://portal.test' } as Env);
  const email = {
    kind: 'EMAIL' as const,
    subject: 'For [Client First Name]',
    previewText: 'About [Tax Year]',
    body: '<p>Dear [Client First Name] [Client Last Name]</p>',
  };

  it('fills subject, preview and body, listing the fields no value fills once', () => {
    const r = service.render(email, values({ 'Client First Name': 'Jamie' }), false);
    expect(r).toEqual({
      subject: 'For Jamie',
      previewText: 'About [Tax Year]',
      body: '<p>Dear Jamie [Client Last Name]</p>',
      unresolved: ['Tax Year', 'Client Last Name'],
      sample: false,
      sms: null,
    });
  });

  it('a value is data: it never becomes markup, before or after the sanitizer', () => {
    const r = service.render(
      email,
      values({ 'Client First Name': '<script>alert(1)</script>', 'Client Last Name': 'x' }),
      false,
    );
    expect(r.body).toBe('<p>Dear &lt;script&gt;alert(1)&lt;/script&gt; x</p>');
    expect(r.subject).not.toContain('<script>');
  });

  it('an SMS is plain text with its length', () => {
    const r = service.render(
      { kind: 'SMS', subject: null, previewText: null, body: 'Hi [Client First Name]' },
      values({ 'Client First Name': 'Jamie' }),
      true,
    );
    expect(r).toMatchObject({ body: 'Hi Jamie', sample: true, sms: { characters: 8, parts: 1 } });
  });

  it('the caller’s sample values win over the data, for a preview', () => {
    const merged = service.withSample(values({ 'Tax Year': '2024' }), {
      'Tax Year': '2025',
      ' Extra ': 'x',
    });
    expect(merged.get('tax year')).toBe('2025');
    expect(merged.get('extra')).toBe('x');
  });
});
