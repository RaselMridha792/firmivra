import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublicLinkBlock } from './index';

const url = 'https://portal.firmivra.com/lvp/book/1';
const embedCode = `<iframe src="${url}?embed=1" title="Consultation"></iframe>`;

describe('PublicLinkBlock (R56)', () => {
  it('shows the link and the embed code, each with its Copy button', () => {
    const html = renderToStaticMarkup(
      <PublicLinkBlock
        url={url}
        embedCode={embedCode}
        title="Booking Link"
        copyLinkLabel="Copy Booking Link"
      />,
    );
    expect(html).toContain('Booking Link');
    expect(html).toContain(`value="${url}"`);
    expect(html).toContain('&lt;iframe src=');
    expect(html).toContain('Copy Booking Link');
    expect(html).toContain('Copy Embed Code');
    expect(html).toContain('readOnly=""');
    expect(html).not.toContain('public-link-empty');
  });

  it('warns when the item takes no new public use', () => {
    const html = renderToStaticMarkup(
      <PublicLinkBlock url={url} embedCode={embedCode} notice="This package is inactive." />,
    );
    expect(html).toContain('public-link-notice');
    expect(html).toContain('This package is inactive.');
  });

  it('shows the empty text, and no fields or buttons, without a link', () => {
    const html = renderToStaticMarkup(
      <PublicLinkBlock url={null} embedCode={null} emptyText="Not available yet." />,
    );
    expect(html).toContain('Not available yet.');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('Copy Link');
  });
});
