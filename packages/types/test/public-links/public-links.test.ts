// Public links (R56): the one shape for intake forms, appointment types and packages, and the
// URL and embed code every API builds the same way.
import { describe, expect, it } from 'vitest';
import {
  PUBLIC_BUTTON_COLOR,
  PublicLink,
  publicButtonCode,
  publicEmbedCode,
  publicIframeCode,
  publicItemUrl,
  publicPortalEntryUrl,
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

describe('publicPortalEntryUrl', () => {
  it('builds the portal sign-in URL from the configured origin and firm slug', () => {
    expect(publicPortalEntryUrl('https://portal.firmivra.com/', 'lvp')).toBe(
      'https://portal.firmivra.com/lvp/sign-in',
    );
    expect(publicPortalEntryUrl('http://portal.localhost:3000//', 'firm-2')).toBe(
      'http://portal.localhost:3000/firm-2/sign-in',
    );
  });
});

describe('publicEmbedCode', () => {
  it('is the website button in the portal default colour, never an iframe', () => {
    const url = `https://portal.firmivra.com/lvp/forms/${ID}`;
    expect(publicEmbedCode(url, 'Tax Consultation')).toBe(
      publicButtonCode(url, 'Tax Consultation'),
    );
    expect(publicEmbedCode(url, 'Tax Consultation')).not.toContain('iframe');
  });

  it('escapes the title and keeps an existing query', () => {
    const code = publicEmbedCode('https://p.example/lvp/forms/1?ref=site', 'Q&A "intro" <b>');
    expect(code).toContain('href="https://p.example/lvp/forms/1?ref=site"');
    expect(code).toContain('>Q&amp;A &quot;intro&quot; &lt;b&gt;</a>');
    expect(code).not.toContain('<b>');
  });
});

describe('publicButtonCode', () => {
  const url = `https://portal.firmivra.com/lvp/book/${ID}`;

  it('is a styled link that opens the page in a new tab, not an iframe', () => {
    const code = publicButtonCode(url, 'Book Tax Consultation', '#0a7a5a');
    expect(code).toMatch(new RegExp(`^<a href="${url}" target="_blank" rel="noopener" style="`));
    expect(code).toContain('background:#0A7A5A');
    expect(code).toContain('color:#FFFFFF');
    expect(code).toContain('text-decoration:none');
    expect(code.endsWith('>Book Tax Consultation</a>')).toBe(true);
    expect(code).not.toContain('<iframe');
  });

  it('takes the portal navy without a colour, or with one that is not #RRGGBB', () => {
    for (const color of [undefined, null, '', 'red', '#FFF', 'url(x)']) {
      expect(publicButtonCode(url, 'Book', color)).toContain(`background:${PUBLIC_BUTTON_COLOR}`);
    }
  });

  it('writes the label near-black on a light colour, so it stays readable', () => {
    expect(publicButtonCode(url, 'Book', '#F5D76E')).toContain('color:#111111');
    expect(publicButtonCode(url, 'Book', '#1F3A6B')).toContain('color:#FFFFFF');
  });

  it('escapes the label and the link', () => {
    const code = publicButtonCode('https://p.example/lvp/book/1?a=1&b="2"', 'Q&A "intro" <b>');
    expect(code).toContain('href="https://p.example/lvp/book/1?a=1&amp;b=&quot;2&quot;"');
    expect(code).toContain('>Q&amp;A &quot;intro&quot; &lt;b&gt;</a>');
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

describe('publicIframeCode (Appointments D3)', () => {
  const url = `https://portal.example.test/lvp/book/${ID}`;

  it('is a lazy iframe of the booking page with a title and a minimum height', () => {
    const code = publicIframeCode(url, 'Book Tax Consultation');
    expect(code).toMatch(
      /^<iframe id="firmivra-[A-Za-z0-9_-]+" src="https:\/\/portal\.example\.test\/lvp\/book\//,
    );
    expect(code).toContain('title="Book Tax Consultation"');
    expect(code).toContain('style="width:100%;border:0;min-height:480px"');
    expect(code).toContain('loading="lazy"');
    expect(code).toContain(`src="${url}"`);
  });

  it("sets the height only from the booking page's origin and this frame's window", () => {
    const code = publicIframeCode(url, 'Book');
    const script = code.slice(code.indexOf('<script>') + 8, code.indexOf('</script>'));
    expect(script).toContain('"https://portal.example.test"');
    expect(script).toContain('e.origin!==o');
    expect(script).toContain('e.source!==f.contentWindow');
    expect(script).toContain('firmivra:height');
    expect(() => new Function(script)).not.toThrow();
  });

  it('escapes every value: a title and a url cannot break out of the attribute or the script', () => {
    const nasty = 'https://portal.example.test/lvp/book/1"><script>alert(1)</script>?a=1&b=2';
    const code = publicIframeCode(nasty, 'Q&A "intro" <b></script>');
    expect(code).toContain('title="Q&amp;A &quot;intro&quot; &lt;b&gt;&lt;/script&gt;"');
    expect(code).not.toContain('alert(1)</script>');
    expect(code.match(/<script>/g)).toHaveLength(1);
    expect(code.match(/<\/script>/g)).toHaveLength(1);
    expect(code).not.toContain('<b>');
  });
});

describe('PublicLink.buttonCode', () => {
  it('is optional, so a link without it still parses', () => {
    const link = {
      kind: 'APPOINTMENT_TYPE' as const,
      itemId: ID,
      url: `https://portal.example.test/lvp/book/${ID}`,
      embedCode: 'x',
      state: 'LIVE' as const,
    };
    expect(PublicLink.safeParse(link).success).toBe(true);
    expect(PublicLink.safeParse({ ...link, buttonCode: '<a></a>' }).success).toBe(true);
  });
});
