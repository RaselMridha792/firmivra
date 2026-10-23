// Public links (R56): the one shape for intake forms, appointment types and packages, and the
// URL and embed code every API builds the same way.
import { describe, expect, it } from 'vitest';
import {
  PUBLIC_EMBED_HEIGHT,
  PublicLink,
  publicEmbedCode,
  publicItemUrl,
} from '../../src/index.js';

const ID = '0f000000-0000-4000-a000-000000000001';

describe('publicItemUrl', () => {
  it('puts each kind under the firm on the configured portal host', () => {
    expect(publicItemUrl('https://portal.firmivra.com', 'lvp', 'INTAKE_FORM', ID)).toBe(
      `https://portal.firmivra.com/lvp/forms/${ID}`,
    );
    expect(publicItemUrl('https://portal.firmivra.com/', 'lvp', 'APPOINTMENT_TYPE', ID)).toBe(
      `https://portal.firmivra.com/lvp/book/${ID}`,
    );
    expect(publicItemUrl('http://portal.localhost:3000//', 'lvp', 'PACKAGE', ID)).toBe(
      `http://portal.localhost:3000/lvp/packages/${ID}`,
    );
  });

  it('encodes the slug and id, so neither can add a path', () => {
    expect(publicItemUrl('https://p.example', 'a/b', 'PACKAGE', '../x')).toBe(
      'https://p.example/a%2Fb/packages/..%2Fx',
    );
  });
});

describe('publicEmbedCode', () => {
  it('is an iframe of the embed layout, full width, titled with the item', () => {
    const url = `https://portal.firmivra.com/lvp/book/${ID}`;
    expect(publicEmbedCode(url, 'Tax Consultation')).toBe(
      `<iframe src="${url}?embed=1" title="Tax Consultation" width="100%" height="${PUBLIC_EMBED_HEIGHT}" style="border:0;max-width:100%" loading="lazy"></iframe>`,
    );
  });

  it('escapes the title and keeps an existing query', () => {
    const code = publicEmbedCode('https://p.example/lvp/forms/1?ref=site', 'Q&A "intro" <b>');
    expect(code).toContain('src="https://p.example/lvp/forms/1?ref=site&amp;embed=1"');
    expect(code).toContain('title="Q&amp;A &quot;intro&quot; &lt;b&gt;"');
    expect(code).not.toContain('<b>');
  });
});

describe('PublicLink', () => {
  it('takes the shape every item answers with', () => {
    const url = publicItemUrl('https://portal.firmivra.com', 'lvp', 'APPOINTMENT_TYPE', ID);
    const link = {
      kind: 'APPOINTMENT_TYPE',
      itemId: ID,
      url,
      embedCode: publicEmbedCode(url, 'Consultation'),
      state: 'ARCHIVED',
    };
    expect(PublicLink.parse(link)).toEqual(link);
    expect(() => PublicLink.parse({ ...link, state: 'GONE' })).toThrow();
    expect(() => PublicLink.parse({ ...link, kind: 'INVOICE' })).toThrow();
  });
});
