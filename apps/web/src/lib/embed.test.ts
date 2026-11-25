import { describe, expect, it } from 'vitest';
import { bookingFrameAncestors, embedAllowedOrigins, publicEmbedFrameAncestors } from './embed';

const env = (value?: string) => ({ EMBED_ALLOWED_ORIGINS: value });
const BOOK = '/lvp/book/0199b6c2-0000-7000-8000-000000000001';

describe('embedAllowedOrigins', () => {
  it('reads comma separated https origins, trimming each and ignoring empties', () => {
    expect(
      embedAllowedOrigins(env('https://site.example.test, https://other.example.test:8443')),
    ).toEqual(['https://site.example.test', 'https://other.example.test:8443']);
    expect(embedAllowedOrigins(env(' https://a.example.test ,, https://b.example.test,'))).toEqual([
      'https://a.example.test',
      'https://b.example.test',
    ]);
    // Space separated is not the format: it is one invalid entry.
    expect(embedAllowedOrigins(env('https://a.example.test https://b.example.test'))).toEqual([]);
  });

  it('drops anything that is not a bare https origin', () => {
    const bad = [
      'http://site.example.test',
      'https://*.example.test',
      '*',
      'https://site.example.test/',
      'https://site.example.test/page',
      'https://site.example.test?x=1',
      'https://user@site.example.test',
      'https://',
      'site.example.test',
      "'self'",
    ];
    expect(embedAllowedOrigins(env([...bad, 'https://ok.example.test'].join(',')))).toEqual([
      'https://ok.example.test',
    ]);
  });

  it('is empty when unset or blank, and lists a repeated origin once', () => {
    expect(embedAllowedOrigins(env())).toEqual([]);
    expect(embedAllowedOrigins(env('  '))).toEqual([]);
    expect(embedAllowedOrigins(env('https://a.example.test,https://a.example.test'))).toEqual([
      'https://a.example.test',
    ]);
  });
});

describe('bookingFrameAncestors', () => {
  it('lists the allowed origins on the booking page', () => {
    expect(
      bookingFrameAncestors(
        'portal',
        BOOK,
        env('https://site.example.test,https://b.example.test'),
      ),
    ).toBe('frame-ancestors https://site.example.test https://b.example.test');
  });

  it("is 'none' when no origin is allowed, or every entry is invalid", () => {
    expect(bookingFrameAncestors('portal', BOOK, env())).toBe("frame-ancestors 'none'");
    expect(bookingFrameAncestors('portal', BOOK, env('https://*.example.test,*'))).toBe(
      "frame-ancestors 'none'",
    );
  });

  it('gives no header to any other route or host', () => {
    const allowed = env('https://site.example.test');
    for (const path of [
      '/',
      '/lvp',
      '/lvp/begin',
      '/lvp/book',
      '/lvp/book/',
      `${BOOK}/extra`,
      '/lvp/packages/1',
      '/lvp/sign-in',
      '/lvp/appointments',
      '/a/b/book/x',
    ]) {
      expect(bookingFrameAncestors('portal', path, allowed)).toBeNull();
    }
    expect(bookingFrameAncestors('firm', BOOK, allowed)).toBeNull();
    expect(bookingFrameAncestors('admin', BOOK, allowed)).toBeNull();
    expect(bookingFrameAncestors(null, BOOK, allowed)).toBeNull();
  });
});

describe('publicEmbedFrameAncestors', () => {
  it('allows the configured origin on public intake pages', () => {
    const allowed = env('https://site.example.test');
    for (const path of [
      '/lvp/begin/annual-tax',
      '/lvp/start/Abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
    ]) {
      expect(publicEmbedFrameAncestors('portal', path, allowed)).toBe(
        'frame-ancestors https://site.example.test',
      );
    }
  });

  it('refuses all framing when no valid origin is configured', () => {
    expect(
      publicEmbedFrameAncestors(
        'portal',
        '/lvp/start/Abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
        env(),
      ),
    ).toBe("frame-ancestors 'none'");
  });

  it('leaves other routes and hosts without an embed policy', () => {
    for (const path of [
      '/lvp',
      '/lvp/book/1',
      '/lvp/appointments',
      '/lvp/sign-in',
      '/lvp/sign-up',
    ]) {
      expect(
        publicEmbedFrameAncestors('portal', path, env('https://site.example.test')),
      ).toBeNull();
    }
    expect(
      publicEmbedFrameAncestors('firm', '/lvp/begin/annual-tax', env('https://site.example.test')),
    ).toBeNull();
  });
});
