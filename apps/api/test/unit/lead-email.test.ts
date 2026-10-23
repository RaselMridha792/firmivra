// Unit: L4's email HTML rules (notify/email-html.ts), the image sniffing and public names
// (leads/lead-email.service.ts), and the lead email template's formatted block.
import { describe, expect, it } from 'vitest';
import { EMAIL_FONTS } from '@firmivra/types';
import { emailImageFile, sniffEmailImage } from '../../src/leads/lead-email.service.js';
import type { Branding } from '../../src/notify/branding.js';
import { cleanEmailHtml, emailHtmlHasContent, firmImages } from '../../src/notify/email-html.js';
import { render, type RenderedEmail } from '../../src/notify/templates.js';

const PORTAL = 'https://portal.example.test';
const ID = '0b6f3c2e-8a1d-4f5e-9c7b-2d4e6f8a0b1c';
const mine = `${PORTAL}/api/v1/portal/sample/email-images/${ID}.png`;
const theirs = `${PORTAL}/api/v1/portal/other/email-images/${ID}.png`;
const clean = (html: string, rule = firmImages(PORTAL, 'sample')) => cleanEmailHtml(html, rule);

describe('cleanEmailHtml', () => {
  it('keeps bold, italic, underline, strike, lists, quotes and alignment', () => {
    const html =
      '<p style="text-align:center"><b>B</b><strong>S</strong><i>I</i><em>E</em><u>U</u><s>X</s></p>' +
      '<ul><li>one</li></ul><ol><li>two</li></ol><blockquote>q</blockquote><h3>h</h3><div>d<br />e</div>';
    expect(clean(html)).toBe(html);
  });

  it('keeps each of the composer’s fonts and sizes, nothing else', () => {
    for (const font of EMAIL_FONTS) {
      expect(
        clean(`<span style="font-family:${font.stack.replaceAll('"', '&quot;')}">x</span>`),
      ).toContain('font-family:');
    }
    expect(clean('<span style="font-size:18px;font-family:Comic Sans MS">x</span>')).toBe(
      '<span style="font-size:18px">x</span>',
    );
    expect(clean('<span style="font-size:17px">x</span>')).toBe('<span>x</span>');
    expect(clean('<span style="font-size:1em">x</span>')).toBe('<span>x</span>');
    expect(clean('<span style="color:red;background:url(https://x.test)">x</span>')).toBe(
      '<span>x</span>',
    );
    expect(clean('<span style="font-weight:bold;font-style:italic">x</span>')).toContain(
      'font-weight:bold;font-style:italic',
    );
  });

  it('turns a browser’s <font face> into a style, if the face is one of the fonts', () => {
    expect(clean('<font face="Verdana">x</font>')).toBe(
      '<span style="font-family:Verdana">x</span>',
    );
    expect(clean('<font face="Wingdings" size="7">x</font>')).toBe('<span>x</span>');
  });

  it('removes scripts, handlers, links, forms, tables and iframes', () => {
    const out = clean(
      '<p onclick="x()">a<script>alert(1)</script><a href="https://evil.test">b</a></p>' +
        '<iframe src="https://evil.test"></iframe><form><input></form><table><tr><td>c</td></tr></table>',
    );
    expect(out).toBe('<p>ab</p>c');
  });

  it('keeps only this firm’s images, at a width from 24 to 600 px', () => {
    expect(clean(`<img src="${mine}" width="240" height="99" alt="Logo">`)).toBe(
      `<img src="${mine}" alt="Logo" width="240" style="width:240px;max-width:100%;height:auto" />`,
    );
    expect(clean(`<img src="${mine}" style="width: 900px">`)).toContain('width="600"');
    expect(clean(`<img src="${mine}" width="3">`)).toContain('width="24"');
    expect(clean(`<img src="${mine}">`)).toBe(
      `<img src="${mine}" alt="" style="max-width:100%;height:auto" />`,
    );
    for (const src of [
      theirs,
      'https://evil.test/x.png',
      `${PORTAL}/api/v1/portal/sample/email-images/${ID}.svg`,
      `${PORTAL}/api/v1/portal/sample/documents/${ID}`,
      'data:image/png;base64,AAAA',
      `javascript:alert(1)`,
      `//portal.example.test/api/v1/portal/sample/email-images/${ID}.png`,
    ]) {
      expect(clean(`<p>x<img src="${src}"></p>`), src).toBe('<p>x</p>');
    }
  });

  it('allows the firm’s logo and email logo addresses', () => {
    for (const src of [
      `${PORTAL}/api/v1/portal/sample/logo?variant=light&v=abc`,
      `${PORTAL}/api/v1/portal/sample/branding/email-logo?v=abc`,
    ]) {
      expect(clean(`<img src="${src}">`)).toContain('<img');
    }
  });

  it('is the same after a second cleaning', () => {
    const once = clean(
      `<p style="text-align:right"><span style="font-family:'Times New Roman', Times, serif;font-size:24px">T</span><img src="${mine}" width="120"></p>`,
    );
    expect(clean(once)).toBe(once);
  });

  it('firmImages without a slug takes any firm on that portal, never another host', () => {
    const any = firmImages(PORTAL);
    expect(any(mine)).toBe(true);
    expect(any(theirs)).toBe(true);
    expect(any(mine.replace(PORTAL, 'https://portal.example.test.evil.test'))).toBe(false);
  });
});

describe('emailHtmlHasContent', () => {
  it('needs some text or an image', () => {
    expect(emailHtmlHasContent('')).toBe(false);
    expect(emailHtmlHasContent('<p> </p><p>&nbsp;</p>')).toBe(false);
    expect(emailHtmlHasContent('<p>Hi</p>')).toBe(true);
    expect(emailHtmlHasContent(`<img src="${mine}" />`)).toBe(true);
  });
});

describe('email images', () => {
  it('sniffs PNG, JPEG and GIF, nothing else', () => {
    expect(sniffEmailImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'image/png',
    );
    expect(sniffEmailImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffEmailImage(Buffer.from('GIF87a'))).toBe('image/gif');
    expect(sniffEmailImage(Buffer.from('GIF89a'))).toBe('image/gif');
    expect(sniffEmailImage(Buffer.from('<svg/>'))).toBeNull();
    expect(sniffEmailImage(Buffer.from('RIFF0000WEBP'))).toBeNull();
  });

  it('reads only {uuid}.png, .jpg or .gif from the public address', () => {
    expect(emailImageFile(`${ID}.png`)).toEqual({ id: ID, type: 'image/png' });
    expect(emailImageFile(`${ID}.jpg`)).toEqual({ id: ID, type: 'image/jpeg' });
    expect(emailImageFile(`${ID}.gif`)).toEqual({ id: ID, type: 'image/gif' });
    for (const bad of [`${ID}.svg`, `${ID}.PNG`, ID, `../${ID}.png`, `${ID}.png.png`]) {
      expect(emailImageFile(bad), bad).toBeNull();
    }
  });
});

describe('lead.message-email with html', () => {
  const firm: Branding = {
    name: 'Sample Firm',
    primaryColor: '#1F3A6B',
    accentColor: '#C9A227',
    logoUrl: null,
    timeZone: 'America/New_York',
    isFirm: true,
  };
  const email = (html: string | null | undefined) =>
    render(
      'lead.message-email',
      {
        name: 'Robin',
        subject: 'Welcome',
        body: 'Plain form',
        ...(html === undefined ? {} : { html }),
      },
      firm,
      { linkOrigins: [PORTAL] },
    ) as RenderedEmail;

  it('sends the formatted HTML, cleaned again, and the plain form as the text part', () => {
    const out = email(
      `<p><b>Bold</b> <span style="font-size:20px">big</span><script>x</script></p><img src="${mine}" width="200"><img src="https://evil.test/x.png">`,
    );
    expect(out.html).toContain('<b>Bold</b>');
    expect(out.html).toContain('font-size:20px');
    expect(out.html).toContain(`src="${mine}"`);
    expect(out.html).not.toContain('script');
    expect(out.html).not.toContain('evil.test');
    expect(out.text).toContain('Plain form');
    expect(out.text).not.toContain('<b>');
  });

  it('falls back to the plain text when there is no HTML or nothing in it shows', () => {
    for (const html of [undefined, null, '<script>x</script>']) {
      const out = email(html);
      expect(out.html).toContain('<p style="margin:0 0 16px;">Plain form</p>');
    }
  });

  it('refuses images when the sites are not configured', () => {
    const out = render(
      'lead.message-email',
      { name: 'Robin', subject: null, body: 'Plain', html: `<p>Hi<img src="${mine}"></p>` },
      firm,
      {},
    ) as RenderedEmail;
    expect(out.html).toContain('<p>Hi</p>');
    expect(out.html).not.toContain('<img src="https://portal');
  });
});
