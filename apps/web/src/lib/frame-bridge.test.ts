import { describe, expect, it } from 'vitest';
import { heightMessage, inFrame, opensInNewTab } from './frame-bridge';

describe('frame bridge', () => {
  it('opens every web link and path in a new tab, but not anchors, mail or phone', () => {
    for (const href of [
      '/lvp/sign-in?book=1',
      '/lvp/sign-up',
      '/lvp',
      'https://portal.example.test/lvp/sign-in',
      'http://portal.localhost:3000/lvp',
      'sign-up',
    ]) {
      expect(opensInNewTab(href), href).toBe(true);
    }
    for (const href of [
      '#top',
      'mailto:a@example.test',
      'tel:+15550100',
      'javascript:void(0)',
      '',
      null,
    ]) {
      expect(opensInNewTab(href), String(href)).toBe(false);
    }
  });

  it('posts the number and nothing else', () => {
    expect(heightMessage(512)).toEqual({ type: 'firmivra:height', height: 512 });
  });

  it('is framed when the parent window is another window', () => {
    const top = {} as Window;
    Object.assign(top, { parent: top });
    expect(inFrame(top)).toBe(false);
    expect(inFrame({ parent: {} } as unknown as Window)).toBe(true);
  });
});
