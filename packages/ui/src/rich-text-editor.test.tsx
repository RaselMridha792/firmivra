import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BUTTON_LINK_CLASS, RichTextEditor, buttonLinkHtml } from './rich-text-editor';

const props = { label: 'Content', value: '<p>Hi</p>', onChange: () => {} };

describe('a call-to-action button link', () => {
  it('is an https link drawn as a button, on its own line, its text escaped', () => {
    expect(buttonLinkHtml(' Upload documents ', 'https://portal.example.test/lvp/upload')).toBe(
      `<p><a class="${BUTTON_LINK_CLASS}" href="https://portal.example.test/lvp/upload">Upload documents</a></p>`,
    );
    expect(buttonLinkHtml('<b>Pay</b> & go', 'https://example.test/?a=1&b="2"')).toBe(
      `<p><a class="${BUTTON_LINK_CLASS}" href="https://example.test/?a=1&amp;b=&quot;2&quot;">&lt;b&gt;Pay&lt;/b&gt; &amp; go</a></p>`,
    );
  });

  it('needs a label and an https address', () => {
    expect(buttonLinkHtml('', 'https://example.test')).toBeNull();
    expect(buttonLinkHtml('Pay', 'http://example.test')).toBeNull();
    expect(buttonLinkHtml('Pay', 'javascript:alert(1)')).toBeNull();
  });
});

describe('the opt-in tools (TP-F07)', () => {
  it('alignment and the button tool show only when asked for', () => {
    const plain = renderToStaticMarkup(<RichTextEditor {...props} />);
    expect(plain).not.toContain('Align left');
    expect(plain).not.toContain('Insert button');
    const full = renderToStaticMarkup(
      <RichTextEditor
        {...props}
        textAlign
        onInsertButton={() => Promise.resolve({ label: 'Pay', href: 'https://example.test' })}
      />,
    );
    for (const label of ['Align left', 'Align centre', 'Align right', 'Insert button'])
      expect(full).toContain(`aria-label="${label}"`);
  });

  it('the image tool stays, disabled, until an upload is given', () => {
    const plain = renderToStaticMarkup(<RichTextEditor {...props} />);
    expect(plain).toMatch(
      /aria-label="Insert image"[^>]*disabled=""|disabled=""[^>]*aria-label="Insert image"/,
    );
  });
});
