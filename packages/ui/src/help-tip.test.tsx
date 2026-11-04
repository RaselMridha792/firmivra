import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  HELP_TIP_CLOSED,
  HelpTip,
  helpTipOpen,
  nextHelpTip,
  placeTip,
  type HelpTipEvent,
} from './help-tip';

const run = (...events: HelpTipEvent[]) => events.reduce(nextHelpTip, HELP_TIP_CLOSED);

describe('the help icon opens on hover, keyboard and tap', () => {
  it('hover shows it while the mouse is on the icon or the bubble', () => {
    expect(helpTipOpen(run('enter'))).toBe(true);
    expect(helpTipOpen(run('enter', 'leave'))).toBe(false);
  });

  it('keyboard focus shows it; Escape hides it until focus comes back', () => {
    expect(helpTipOpen(run('focus'))).toBe(true);
    expect(helpTipOpen(run('focus', 'escape'))).toBe(false);
    expect(helpTipOpen(run('focus', 'escape', 'blur', 'focus'))).toBe(true);
    expect(helpTipOpen(run('focus', 'blur'))).toBe(false);
  });

  it('a tap or click keeps it open; a second one, a press elsewhere or Escape closes it', () => {
    expect(helpTipOpen(run('press'))).toBe(true);
    expect(helpTipOpen(run('press', 'press'))).toBe(false);
    expect(helpTipOpen(run('press', 'outside'))).toBe(false);
    expect(helpTipOpen(run('press', 'escape'))).toBe(false);
    expect(helpTipOpen(run('press', 'press', 'press'))).toBe(true);
  });

  it('a click while hovering keeps it after the mouse leaves', () => {
    expect(helpTipOpen(run('enter', 'press', 'leave'))).toBe(true);
    expect(helpTipOpen(run('enter', 'press', 'press'))).toBe(false);
  });

  it('Escape on a hover hides it without moving the mouse; the next hover shows it again', () => {
    expect(helpTipOpen(run('enter', 'escape'))).toBe(false);
    expect(helpTipOpen(run('enter', 'escape', 'leave', 'enter'))).toBe(true);
  });

  it('focus moving away closes a pinned bubble', () => {
    expect(helpTipOpen(run('focus', 'press', 'blur'))).toBe(false);
  });
});

const viewport = { width: 1440, height: 900 };
const tip = { width: 288, height: 120 };

describe('placeTip: the bubble stays inside the window', () => {
  it('opens below the icon, centred on it', () => {
    expect(placeTip({ top: 100, bottom: 124, left: 600, right: 624 }, tip, viewport)).toEqual({
      top: 130,
      left: 612 - 144,
    });
  });

  it('opens above when the room below is short', () => {
    const at = placeTip({ top: 820, bottom: 844, left: 600, right: 624 }, tip, viewport);
    expect(at.top).toBe(820 - 6 - 120);
  });

  it('keeps 8 px from the edges at 375 px', () => {
    const narrow = { width: 375, height: 700 };
    expect(placeTip({ top: 100, bottom: 124, left: 4, right: 28 }, tip, narrow).left).toBe(8);
    expect(placeTip({ top: 100, bottom: 124, left: 347, right: 371 }, tip, narrow).left).toBe(
      375 - 288 - 8,
    );
  });
});

describe('HelpTip', () => {
  it('is a named button described by its text, closed until used', () => {
    const html = renderToStaticMarkup(
      <HelpTip topic="Merge fields">Insert a client or firm detail at the cursor.</HelpTip>,
    );
    expect(html).toContain('aria-label="About Merge fields"');
    expect(html).toContain('aria-expanded="false"');
    const described = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(described).toBeTruthy();
    expect(html).toContain(
      `<span id="${described}" hidden="">Insert a client or firm detail at the cursor.</span>`,
    );
    expect(html.match(/<svg/g)).toHaveLength(1);
    expect(html).not.toContain('data-testid="help-tip"');
  });
});
