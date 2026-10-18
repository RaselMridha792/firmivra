// R55: the pure parts of templates: the merge-field tokens and how they are filled (a value is
// data, never markup; a field with no value is listed, not blanked), an SMS's length, and what the
// HTML sanitizer lets through.
import { describe, expect, it } from 'vitest';
import { sanitize, stripTags, toPlainText } from '../../src/templates/html.js';
import {
  BUILT_IN_FIELDS,
  builtIn,
  fieldsIn,
  fill,
  smsLength,
} from '../../src/templates/merge-fields.js';

const values = (o: Record<string, string>) =>
  new Map(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));

describe('the built-in fields', () => {
  it('cover the guide’s groups, each key once, and are found in any case', () => {
    const keys = BUILT_IN_FIELDS.map((x) => x.key.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(BUILT_IN_FIELDS.map((x) => x.group))).toEqual(
      new Set(['CLIENT', 'COMPANY', 'STAFF', 'APPOINTMENT', 'INVOICE', 'TAX', 'WORKFLOW']),
    );
    expect(builtIn('client first name')?.key).toBe('Client First Name');
    expect(builtIn('Appointment Location/Link')?.group).toBe('APPOINTMENT');
    expect(builtIn('Nope')).toBeUndefined();
    // Money and filing status are the restricted ones.
    expect(BUILT_IN_FIELDS.filter((x) => x.sensitive).map((x) => x.key)).toEqual([
      'Balance Due',
      'Payment Link',
      'Payment Status',
      'Filing Status',
    ]);
  });
});

describe('fieldsIn', () => {
  it('lists the fields a text uses, each once in its first spelling, across texts', () => {
    expect(
      fieldsIn(
        'Hello [Client First Name], your [Tax Year] return',
        'Re: [tax year] and [Appointment Location/Link]',
        null,
        undefined,
      ),
    ).toEqual(['Client First Name', 'Tax Year', 'Appointment Location/Link']);
  });

  it('ignores brackets that are not a field', () => {
    expect(fieldsIn('[ ] [] [1st] [a[b]] plain [text')).toEqual(['b']);
    expect(fieldsIn('x'.repeat(200))).toEqual([]);
  });
});

describe('fill', () => {
  it('fills the fields it has a value for, in any case', () => {
    const r = fill(
      'Hi [Client First Name] [client LAST name]!',
      values({ 'Client First Name': 'Jamie', 'Client Last Name': 'Sample' }),
      'text',
    );
    expect(r).toEqual({ text: 'Hi Jamie Sample!', unresolved: [] });
  });

  it('leaves a field with no value in the text and lists it once', () => {
    const r = fill('[Tax Year] [Tax Year] [Payment Link]', values({ 'Payment Link': '' }), 'text');
    expect(r.text).toBe('[Tax Year] [Tax Year] [Payment Link]');
    expect(r.unresolved).toEqual(['Tax Year', 'Payment Link']);
  });

  it('escapes a value in HTML: data is never markup', () => {
    const r = fill(
      '<p>Dear [Client First Name]</p>',
      values({ 'Client First Name': '<img src=x onerror="alert(1)">&"\'' }),
      'html',
    );
    expect(r.text).toBe(
      '<p>Dear &lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&quot;&#39;</p>',
    );
    // As text, it is as it is (a text message has no markup to break).
    expect(fill('[A]', values({ A: '<b>' }), 'text').text).toBe('<b>');
  });

  it('a value that looks like a field is not filled again', () => {
    const r = fill('[A] [B]', values({ A: '[B]', B: 'bee' }), 'text');
    expect(r.text).toBe('[B] bee');
  });
});

describe('smsLength', () => {
  it('counts 160 characters a part, 153 once it takes more', () => {
    expect(smsLength('')).toEqual({ characters: 0, parts: 0 });
    expect(smsLength('a'.repeat(160))).toEqual({ characters: 160, parts: 1 });
    expect(smsLength('a'.repeat(161))).toEqual({ characters: 161, parts: 2 });
    expect(smsLength('a'.repeat(306))).toEqual({ characters: 306, parts: 2 });
    expect(smsLength('a'.repeat(307))).toEqual({ characters: 307, parts: 3 });
  });

  it('counts 70 and 67 once a character is outside the GSM alphabet', () => {
    expect(smsLength('Hello ✓')).toEqual({ characters: 7, parts: 1 });
    expect(smsLength(`✓${'a'.repeat(70)}`).parts).toBe(2);
    expect(smsLength(`✓${'a'.repeat(133)}`).parts).toBe(2);
    expect(smsLength(`✓${'a'.repeat(134)}`).parts).toBe(3);
  });
});

describe('sanitize', () => {
  it('keeps the rich text a template needs', () => {
    const html =
      '<h2 style="text-align:center">Hello</h2><p>See <a href="https://example.com/x" target="_blank">this</a> or <strong>that</strong>.</p><ul><li>One</li></ul><img src="https://example.com/logo.png" alt="Logo" width="120"><table><tr><td>Cell</td></tr></table>';
    const r = sanitize(html);
    expect(r.html).toContain('<h2 style="text-align:center">Hello</h2>');
    expect(r.html).toContain('<strong>that</strong>');
    expect(r.html).toContain('<li>One</li>');
    expect(r.html).toContain('<img src="https://example.com/logo.png" alt="Logo" width="120" />');
    expect(r.html).toContain('<td>Cell</td>');
    expect(r.removed).toBe(0);
  });

  it('a link that opens a new window cannot reach back', () => {
    expect(sanitize('<a href="https://example.com" target="_blank">x</a>').html).toContain(
      'rel="noopener noreferrer"',
    );
  });

  it('keeps a merge field in a link, which is filled and checked later', () => {
    expect(sanitize('<a href="[Client Portal Link]">Open</a>').html).toBe(
      '<a href="[Client Portal Link]">Open</a>',
    );
  });

  it('removes scripts, handlers, forms, unsafe links and other styles, and counts them', () => {
    const html =
      '<p onclick="steal()">Hi</p><script>alert(1)</script><iframe src="https://evil.example"></iframe><form action="/x"><input name="a"></form><a href="javascript:alert(1)">go</a><img src="data:image/png;base64,AAAA"><p style="position:fixed;color:red">fixed</p><style>p{display:none}</style>';
    const r = sanitize(html);
    expect(r.html).not.toMatch(
      /script|iframe|form|input|onclick|javascript:|data:|position|<style/i,
    );
    expect(r.html).toContain('<p>Hi</p>');
    expect(r.html).toContain('fixed');
    expect(r.removed).toBeGreaterThanOrEqual(6);
  });
});

describe('plain text', () => {
  it('turns HTML into lines for a text message or a text part', () => {
    expect(toPlainText('<p>Hello &amp; welcome</p><p>Line two<br>Line three</p>')).toBe(
      'Hello & welcome\nLine two\nLine three',
    );
    expect(toPlainText('<ul><li>One</li><li>Two</li></ul>')).toBe('One\nTwo');
  });

  it('strips tags from text and keeps the rest', () => {
    expect(stripTags('Hi <b>there</b> <script>x</script>[Client First Name]')).toBe(
      'Hi there [Client First Name]',
    );
  });
});
