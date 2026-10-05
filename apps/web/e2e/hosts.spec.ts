// The host map (src/lib/hosts.ts): which site each configured host serves.
import { expect, test } from '@playwright/test';
import { areaForHost } from '../src/lib/hosts';

const cloudFront = {
  ADMIN_HOST: 'd111aaa.cloudfront.net',
  APP_HOST: 'd222bbb.cloudfront.net',
  PORTAL_HOST: 'd333ccc.cloudfront.net',
};

test('maps configured hosts to sites, ignoring port and case', () => {
  expect(areaForHost('D111AAA.cloudfront.net', cloudFront)).toBe('admin');
  expect(areaForHost('d222bbb.cloudfront.net:443', cloudFront)).toBe('firm');
  expect(areaForHost('d333ccc.cloudfront.net', cloudFront)).toBe('portal');
});

test('unknown hosts serve no site', () => {
  expect(areaForHost('d999zzz.cloudfront.net', cloudFront)).toBeUndefined();
  expect(areaForHost('localhost:3000', cloudFront)).toBeUndefined();
  expect(areaForHost(null, cloudFront)).toBeUndefined();
});

test('defaults to the local hosts when nothing is configured', () => {
  expect(areaForHost('admin.localhost:3000', {})).toBe('admin');
  expect(areaForHost('app.localhost', {})).toBe('firm');
  expect(areaForHost('portal.localhost:3300', {})).toBe('portal');
});

test('works for the later custom domain without code changes', () => {
  const custom = {
    ADMIN_HOST: 'admin.dev.firmivra.com',
    APP_HOST: 'app.dev.firmivra.com',
    PORTAL_HOST: 'portal.dev.firmivra.com',
  };
  expect(areaForHost('portal.dev.firmivra.com', custom)).toBe('portal');
});
