import { describe, expect, it } from 'vitest';
import { BUTTON_CLASS, BUTTON_STYLE, sanitize } from '../../src/templates/html.js';

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
