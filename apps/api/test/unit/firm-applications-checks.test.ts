import { describe, expect, it } from 'vitest';
import {
  emailDomainCheck,
  FREE_MAIL_DOMAINS,
} from '../../src/firm-applications/firm-applications.service.js';

const result = (email: string, website: string | null) => emailDomainCheck(email, website).result;

describe('emailDomainCheck: the EMAIL_DOMAIN check on the review page', () => {
  it("passes when the email's domain is the website's, with or without www", () => {
    expect(emailDomainCheck('jordan@sample.example.test', 'https://sample.example.test')).toEqual({
      key: 'EMAIL_DOMAIN',
      result: 'PASS',
      note: 'The email domain matches the website',
    });
    expect(result('jordan@sample.example.test', 'https://www.sample.example.test/about')).toBe(
      'PASS',
    );
    expect(result('Jordan@Sample.Example.Test', 'HTTP://SAMPLE.example.test')).toBe('PASS');
    expect(result('jordan@sample.example.test', 'https://tax.sample.example.test')).toBe('PASS');
  });

  it('reads a website without https:// the way the apply form does', () => {
    expect(result('jordan@sample.example.test', ' sample.example.test ')).toBe('PASS');
    expect(result('jordan@sample.example.test', 'www.sample.example.test')).toBe('PASS');
  });

  it('warns when the domains differ, or the email has no domain', () => {
    expect(emailDomainCheck('jordan@other.example.test', 'https://sample.example.test')).toEqual({
      key: 'EMAIL_DOMAIN',
      result: 'WARN',
      note: "The email domain doesn't match the website",
    });
    expect(result('jordan@example.test', 'https://sample-example.test')).toBe('WARN');
    expect(result('not-an-email', 'https://sample.example.test')).toBe('WARN');
  });

  it('warns on a free email address whatever the website', () => {
    for (const website of [null, 'https://sample.example.test', 'not a website', 'gmail.com']) {
      expect(emailDomainCheck('jordan.sample@gmail.com', website)).toEqual({
        key: 'EMAIL_DOMAIN',
        result: 'WARN',
        note: 'A free email address',
      });
    }
    expect(result('Jordan.Sample@Outlook.COM', null)).toBe('WARN');
    for (const domain of FREE_MAIL_DOMAINS) {
      expect(result(`jordan.sample@${domain}`, null), domain).toBe('WARN');
    }
  });

  it('skips without a website', () => {
    for (const website of [null, '', '   ']) {
      expect(emailDomainCheck('jordan@sample.example.test', website)).toEqual({
        key: 'EMAIL_DOMAIN',
        result: 'SKIPPED',
        note: 'No website to compare with',
      });
    }
  });

  it("skips a stored website that isn't an address, instead of throwing", () => {
    for (const website of [
      'not a website',
      'https://',
      'javascript:alert(1)',
      'https://sample.example.test:99999',
      'http://[::1',
    ]) {
      expect(emailDomainCheck('jordan@sample.example.test', website), website).toEqual({
        key: 'EMAIL_DOMAIN',
        result: 'SKIPPED',
        note: "The website isn't a valid address",
      });
    }
  });

  it('skips a stored website whose host is no domain name, as the apply form refuses it', () => {
    // Each one is a URL once https:// is put in front, with a host like "n" or "ftp".
    for (const website of [
      'N/A',
      'none',
      'TBD',
      '-',
      'javascript:',
      'mailto:',
      'ftp://sample.example.test',
      'http:/sample.example.test',
      'localhost',
      'https://192.0.2.1',
    ]) {
      expect(emailDomainCheck('jordan@sample.example.test', website), website).toEqual({
        key: 'EMAIL_DOMAIN',
        result: 'SKIPPED',
        note: "The website isn't a valid address",
      });
    }
  });
});
