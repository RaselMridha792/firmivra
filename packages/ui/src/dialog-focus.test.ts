import { describe, expect, it } from 'vitest';
import { wrapStop } from './dialog-focus';

// Integrations Review Two I-R2-09: in a dialog, Tab from the last control goes to the first and
// Shift+Tab from the first goes to the last; in between, the browser moves focus itself.

const stops = ['close', 'name', 'notes', 'cancel', 'submit'];

describe('Tab stays inside a dialog', () => {
  it('Tab from the last control goes back to the first', () => {
    expect(wrapStop(stops, 'submit', false)).toBe('close');
  });

  it('Shift+Tab from the first control goes to the last', () => {
    expect(wrapStop(stops, 'close', true)).toBe('submit');
  });

  it('leaves every other move to the browser', () => {
    expect(wrapStop(stops, 'name', false)).toBeNull();
    expect(wrapStop(stops, 'notes', true)).toBeNull();
    expect(wrapStop(stops, 'submit', true)).toBeNull();
    expect(wrapStop(stops, 'close', false)).toBeNull();
  });

  it('keeps focus on a dialog with one control, as before', () => {
    expect(wrapStop(['close'], 'close', false)).toBe('close');
    expect(wrapStop(['close'], 'close', true)).toBe('close');
  });

  it('does nothing for focus outside its controls, or with none', () => {
    expect(wrapStop(stops, 'menu-in-a-popover', false)).toBeNull();
    expect(wrapStop(stops, null, false)).toBeNull();
    expect(wrapStop([], 'close', false)).toBeNull();
  });

  it('treats a radio group as one stop at either end', () => {
    const group = ['close', 'name', 'when:now', 'when:later'];
    const same = (a: string, b: string) =>
      a === b || (a.startsWith('when:') && b.startsWith('when:'));
    // The chosen radio is "Now", the first of the group, yet the group is the last stop.
    expect(wrapStop(group, 'when:now', false, same)).toBe('close');
    expect(wrapStop(group, 'close', true, same)).toBe('when:later');
  });
});
