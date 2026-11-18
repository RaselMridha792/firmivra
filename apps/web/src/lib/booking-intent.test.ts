import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  afterSignIn,
  bookingKey,
  bookingPath,
  clearBooking,
  keepBooking,
  pendingBooking,
  pendingPackage,
  returnPathOf,
  signInWithReturn,
  typeIdOf,
} from './booking-intent';

const TYPE = '0f000000-0000-4000-a000-000000000001';
const OTHER = '0f000000-0000-4000-a000-000000000002';
const PACKAGE = '0f000000-0000-4000-a000-000000000003';
const DAY = 24 * 60 * 60_000;

/** A Storage of the test's own, so each test starts empty. */
function fakeStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (k) => items.get(k) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (k) => void items.delete(k),
    setItem: (k, v) => void items.set(k, String(v)),
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('booking intent (Appointments Review 2, row 3)', () => {
  it('keeps the chosen type per firm until booking opens on it', () => {
    keepBooking('LVP', TYPE);
    expect(pendingBooking('lvp')).toBe(TYPE);
    expect(pendingBooking('other-firm')).toBeNull();
    clearBooking('lvp');
    expect(pendingBooking('lvp')).toBeNull();
  });

  it('forgets a type after 30 days', () => {
    const now = Date.now();
    keepBooking('lvp', TYPE, now - 31 * DAY);
    expect(pendingBooking('lvp', now)).toBeNull();
    expect(localStorage.getItem(bookingKey('lvp'))).toBeNull();
    keepBooking('lvp', TYPE, now - 29 * DAY);
    expect(pendingBooking('lvp', now)).toBe(TYPE);
  });

  it('keeps only an id that can be a type, and reads nothing else back', () => {
    keepBooking('lvp', '../home');
    expect(localStorage.getItem(bookingKey('lvp'))).toBeNull();
    localStorage.setItem(bookingKey('lvp'), JSON.stringify({ typeId: 'x', at: Date.now() }));
    expect(pendingBooking('lvp')).toBeNull();
    localStorage.setItem(bookingKey('lvp'), 'not json');
    expect(pendingBooking('lvp')).toBeNull();
    expect(typeIdOf(TYPE.toUpperCase())).toBe(TYPE.toUpperCase());
    expect(typeIdOf('')).toBeNull();
  });

  it('works without storage: nothing is kept and nothing throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => keepBooking('lvp', TYPE)).not.toThrow();
    expect(pendingBooking('lvp')).toBeNull();
    expect(() => clearBooking('lvp')).not.toThrow();
    // The sign-in link's own ?book= still lands on the type.
    expect(afterSignIn('lvp', TYPE)).toBe(bookingPath('lvp', TYPE));
  });

  it('sends a client to booking on the type after sign-in, else home', () => {
    expect(afterSignIn('lvp')).toBe('/lvp/home');
    keepBooking('lvp', TYPE);
    expect(afterSignIn('lvp')).toBe(`/lvp/appointments?book=${TYPE}`);
    // The link they just followed wins over an older kept type.
    expect(afterSignIn('lvp', OTHER)).toBe(`/lvp/appointments?book=${OTHER}`);
    expect(afterSignIn('lvp', 'javascript:alert(1)')).toBe(`/lvp/appointments?book=${TYPE}`);
  });

  it('INTAKE-ACCESS-01: sign-in lands back on the portal page opened (an intake email), only inside the firm', () => {
    const form = '/lvp/intake/0199b6a8-0000-7000-8000-000000000004';
    expect(signInWithReturn('/lvp/sign-in', 'lvp', form)).toBe(
      `/lvp/sign-in?next=${encodeURIComponent(form)}`,
    );
    expect(afterSignIn('lvp', null, form)).toBe(form);
    expect(afterSignIn('lvp', null, `${form}?step=review`)).toBe(`${form}?step=review`);
    // A booking link's type still wins; a kept one does not beat the page just opened.
    expect(afterSignIn('lvp', TYPE, form)).toBe(bookingPath('lvp', TYPE));
    keepBooking('lvp', OTHER);
    expect(afterSignIn('lvp', null, form)).toBe(form);
    // Never another site, another firm, or the sign-in pages.
    for (const bad of [
      'https://evil.test/lvp/home',
      '//evil.test/lvp/home',
      '/\\evil.test/lvp/home',
      '/lvp/..\\..\\evil',
      '/other/intake/1',
      '/lvp/sign-in',
      '/lvp/sign-up/done',
      'lvp/home',
      'javascript:alert(1)',
    ]) {
      expect(returnPathOf('lvp', bad), bad).toBeNull();
    }
    expect(signInWithReturn('/lvp/sign-in', 'lvp', '/lvp/sign-in')).toBe('/lvp/sign-in');
    expect(afterSignIn('lvp', null, '//evil.test/x')).toBe(`/lvp/appointments?book=${OTHER}`);
  });
});

describe('booking from a package’s page (S12)', () => {
  it('carries the package with the type, and only an id that can be one', () => {
    expect(bookingPath('lvp', TYPE, PACKAGE)).toBe(
      `/lvp/appointments?book=${TYPE}&package=${PACKAGE}`,
    );
    expect(bookingPath('lvp', TYPE, '../home')).toBe(`/lvp/appointments?book=${TYPE}`);
    expect(afterSignIn('lvp', TYPE, null, PACKAGE)).toBe(bookingPath('lvp', TYPE, PACKAGE));
  });

  it('keeps the package with the type for the next sign-in, and forgets both together', () => {
    keepBooking('lvp', TYPE, Date.now(), PACKAGE);
    expect(pendingPackage('lvp', TYPE)).toBe(PACKAGE);
    expect(pendingPackage('lvp', OTHER)).toBeNull();
    expect(afterSignIn('lvp')).toBe(`/lvp/appointments?book=${TYPE}&package=${PACKAGE}`);
    // A plain booking link for the type later keeps no package.
    keepBooking('lvp', TYPE);
    expect(pendingPackage('lvp', TYPE)).toBeNull();
    keepBooking('lvp', TYPE, Date.now(), 'not-an-id');
    expect(pendingPackage('lvp', TYPE)).toBeNull();
    keepBooking('lvp', TYPE, Date.now(), PACKAGE);
    clearBooking('lvp');
    expect(pendingPackage('lvp', TYPE)).toBeNull();
  });
});
