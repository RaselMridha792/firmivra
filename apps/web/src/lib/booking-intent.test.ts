import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  afterSignIn,
  bookingKey,
  bookingPath,
  clearBooking,
  keepBooking,
  pendingBooking,
  typeIdOf,
} from './booking-intent';

const TYPE = '0f000000-0000-4000-a000-000000000001';
const OTHER = '0f000000-0000-4000-a000-000000000002';
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
});
