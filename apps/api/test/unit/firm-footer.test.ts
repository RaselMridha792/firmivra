// Templates Review Two Y10: the firm's footer and disclaimer on an email from a template, once.
import { describe, expect, it } from 'vitest';
import { withFirmFooterHtml, withFirmFooterText } from '../../src/templates/firm-footer.js';

const firm = { footer: 'Fake Firm · 1 Main St', disclaimer: 'For the client only.\nNot advice.' };

describe('withFirmFooterHtml', () => {
  it('adds the footer, then the disclaimer, as escaped text', () => {
    expect(withFirmFooterHtml('<p>Hi</p>', firm)).toBe(
      '<p>Hi</p><p>Fake Firm · 1 Main St</p><p><small>For the client only.<br />Not advice.</small></p>',
    );
    expect(withFirmFooterHtml('<p>Hi</p>', { footer: '<b>x</b> & "y"', disclaimer: null })).toBe(
      '<p>Hi</p><p>&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;</p>',
    );
  });

  it('never adds one the body already has, in any case or spacing, so neither appears twice', () => {
    const once = withFirmFooterHtml('<p>Hi</p>', firm);
    expect(withFirmFooterHtml(once, firm)).toBe(once);
    expect(withFirmFooterHtml('<p>FAKE FIRM ·  1 main st</p>', firm)).toBe(
      '<p>FAKE FIRM ·  1 main st</p><p><small>For the client only.<br />Not advice.</small></p>',
    );
  });

  it('leaves the body as it is when the firm has neither', () => {
    expect(withFirmFooterHtml('<p>Hi</p>', { footer: null, disclaimer: null })).toBe('<p>Hi</p>');
  });
});

describe('withFirmFooterText', () => {
  it('adds what is missing as paragraphs of text', () => {
    expect(withFirmFooterText('Hi', firm)).toBe(
      'Hi\n\nFake Firm · 1 Main St\n\nFor the client only.\nNot advice.',
    );
    expect(withFirmFooterText('Hi\n\nFor the client only. Not advice.', firm)).toBe(
      'Hi\n\nFor the client only. Not advice.\n\nFake Firm · 1 Main St',
    );
  });
});
