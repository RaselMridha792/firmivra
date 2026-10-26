import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActionMenu, placeMenu } from './action-menu';

const viewport = { width: 1440, height: 900 };
const menu = { width: 288, height: 400 };

describe('placeMenu (SH2: the row menu is never clipped)', () => {
  it('opens below the trigger, aligned to its right edge', () => {
    const at = placeMenu(
      { top: 100, bottom: 136, left: 1100, right: 1136 },
      menu,
      viewport,
      'right',
    );
    expect(at).toEqual({ top: 140, left: 1136 - 288, maxHeight: 512 });
  });

  it('opens above when the room below is short and there is more above', () => {
    const at = placeMenu(
      { top: 760, bottom: 796, left: 1100, right: 1136 },
      menu,
      viewport,
      'right',
    );
    expect(at.top).toBe(760 - 4 - 400);
    expect(at.maxHeight).toBe(512);
  });

  it('stays inside the window and scrolls inside itself when the window is short', () => {
    const at = placeMenu(
      { top: 200, bottom: 236, left: 4, right: 40 },
      { width: 288, height: 900 },
      { width: 375, height: 600 },
      'right',
    );
    expect(at.left).toBe(8);
    expect(at.maxHeight).toBe(600 - 236 - 4 - 8);
    const left = placeMenu(
      { top: 10, bottom: 46, left: 300, right: 336 },
      menu,
      { width: 375, height: 800 },
      'left',
    );
    expect(left.left).toBe(375 - 288 - 8);
  });
});

describe('ActionMenu', () => {
  it('draws one arrow, closed until clicked', () => {
    const html = renderToStaticMarkup(
      <ActionMenu
        label="Actions for Fake Client"
        trigger="More Actions"
        sections={[{ items: [{ label: 'View', onSelect: () => undefined }] }]}
      />,
    );
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html.match(/<svg/g)).toHaveLength(1);
    expect(html).not.toContain('role="menu"');
  });
});
