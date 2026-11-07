import { describe, expect, it } from 'vitest';
import {
  BUTTON_CLASS,
  BUTTON_STYLE,
  sanitize,
  sanitizeForPortal,
} from '../../src/templates/html.js';

// TP-F07 (the lead's Nov 7 answer): a template's content keeps alignment (left, centre, right),
// images at a width an email can show, and a call-to-action link drawn as a button; nothing else.
describe('the template sanitizer', () => {
  const clean = (html: string) => sanitize(html).html;

  it('keeps left, centre and right alignment, and nothing else of a style', () => {
    expect(clean('<p style="text-align: center; color: red">C</p>')).toBe(
      '<p style="text-align:center">C</p>',
    );
    expect(clean('<p style="text-align: justify">J</p>')).toBe('<p>J</p>');
  });

  it('draws an https button link with its own look, whatever the author wrote', () => {
    const out = clean(
      `<a class="${BUTTON_CLASS} big" style="background:url(x)" href="https://portal.example.test/up">Upload</a>`,
    );
    expect(out).toContain(`class="${BUTTON_CLASS}"`);
    expect(out).toContain(`style="${BUTTON_STYLE}"`);
    expect(out).toContain('href="https://portal.example.test/up"');
    expect(out).not.toContain('url(');
  });

  it('a button class on anything but an https link, or any other class, goes', () => {
    expect(clean(`<a class="${BUTTON_CLASS}" href="http://example.test">x</a>`)).toBe(
      '<a href="http://example.test">x</a>',
    );
    expect(clean('<a class="other" href="https://example.test">x</a>')).toBe(
      '<a href="https://example.test">x</a>',
    );
    expect(clean(`<p class="${BUTTON_CLASS}">x</p>`)).toBe('<p>x</p>');
  });

  it('an image keeps a width within 24 to 600 px and is never wider than the email', () => {
    expect(
      clean('<img src="https://example.test/a.png" style="width: 240px; position: fixed">'),
    ).toBe(
      '<img src="https://example.test/a.png" alt="" width="240" style="width:240px;max-width:100%;height:auto" />',
    );
    expect(clean('<img src="https://example.test/a.png" width="9000">')).toContain('width="600"');
    expect(clean('<img src="javascript:alert(1)">')).not.toContain('javascript');
  });
});

describe('the content fonts (CM-F10)', () => {
  const clean = (html: string) => sanitize(html).html;

  it('keeps the five mail-safe fonts, and drops any other', () => {
    expect(clean('<span style="font-family: Georgia, serif">G</span>')).toBe(
      '<span style="font-family:Georgia, serif">G</span>',
    );
    expect(
      clean('<span style="font-family: &quot;Times New Roman&quot;, Times, serif">T</span>'),
    ).toContain('font-family:');
    expect(clean('<span style="font-family: Comic Sans MS">C</span>')).toBe('<span>C</span>');
    expect(clean('<span style="font-family: Arial; background: url(x)">A</span>')).toBe(
      '<span style="font-family:Arial">A</span>',
    );
  });

  it("a browser's <font face> keeps its face as a style", () => {
    expect(clean('<font face="Verdana">V</font>')).toBe(
      '<span style="font-family:Verdana">V</span>',
    );
  });
});

describe('an announcement for the client portal (CM-F08)', () => {
  const own = (src: string) =>
    src.startsWith('https://portal.example.test/api/v1/portal/lvp/email-images/');
  const firmImage =
    'https://portal.example.test/api/v1/portal/lvp/email-images/0199d2b0-6c00-7000-8000-000000000001.png';

  it("keeps the firm's own images and drops scripts, outside images and another firm's", () => {
    const out = sanitizeForPortal(
      `<p>Hi<script>alert(1)</script></p><img src="${firmImage}" onerror="x()">` +
        '<img src="https://evil.example/x.png">' +
        '<img src="https://portal.example.test/api/v1/portal/other/email-images/0199d2b0-6c00-7000-8000-000000000002.png">',
      own,
    );
    expect(out).toContain(`src="${firmImage}"`);
    expect(out).not.toContain('script');
    expect(out).not.toContain('onerror');
    expect(out).not.toContain('evil.example');
    expect(out).not.toContain('/portal/other/');
  });

  it('links are https only and open apart; the button keeps its look; tables and other attributes go', () => {
    const out = sanitizeForPortal(
      `<p style="text-align:center" title="t"><a class="${BUTTON_CLASS}" href="https://pay.example.test">Pay</a> <a href="http://plain.example.test">x</a> <a href="mailto:a@b.test">m</a></p><table><tr><td>T</td></tr></table>`,
      own,
    );
    expect(out).toContain('<p style="text-align:center">');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain(`class="${BUTTON_CLASS}"`);
    expect(out).toContain(`style="${BUTTON_STYLE}"`);
    expect(out).not.toContain('http://plain');
    expect(out).not.toContain('mailto:');
    expect(out).not.toContain('<table');
    expect(out).not.toContain('title=');
  });
});
