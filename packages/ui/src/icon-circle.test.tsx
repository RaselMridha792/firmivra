import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Lightbulb } from '@phosphor-icons/react';
import { IconCircle, portalIconTones, portalTints } from './index';

describe('IconCircle (R61)', () => {
  it('draws the icon in the firm text colour on the chosen tint, hidden from screen readers', () => {
    const html = renderToStaticMarkup(<IconCircle icon={Lightbulb} tint="peach" />);
    expect(html).toContain('bg-portal-tint-peach');
    expect(html).toContain('text-firm-text');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('<svg');
  });

  it('defaults to the pale page-title circle at the medium size', () => {
    const html = renderToStaticMarkup(<IconCircle icon={Lightbulb} />);
    expect(html).toContain('bg-folder-surface');
    expect(html).toContain('size-12');
  });

  it('maps every tint and icon tone to a portal colour token', () => {
    for (const cls of Object.values(portalTints)) expect(cls).toMatch(/^bg-(portal-tint|folder)-/);
    for (const cls of Object.values(portalIconTones)) expect(cls).toMatch(/^text-portal-icon-/);
  });
});
