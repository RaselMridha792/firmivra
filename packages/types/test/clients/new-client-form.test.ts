import { describe, expect, it } from 'vitest';
import { NewClientForm } from '../../src/index.js';

// Fake values only (CLAUDE.md rule 9).
const home = { line1: '1 Fake Street', city: 'Faketown', state: 'GA', postalCode: '30301' };
const individual = {
  accountType: 'INDIVIDUAL',
  displayName: 'Fake Person',
  email: 'fake.person@example.test',
  phone: '(404) 555-0100',
  profile: { address: home },
} as const;

const issues = (body: unknown) => {
  const result = NewClientForm.safeParse(body);
  return result.success
    ? {}
    : Object.fromEntries(result.error.issues.map((i) => [i.path.join('.'), i.message]));
};

describe('NewClientForm (Octavia D1)', () => {
  it('takes a complete Individual and a complete Business', () => {
    expect(NewClientForm.safeParse(individual).success).toBe(true);
    const business = {
      ...individual,
      accountType: 'BUSINESS',
      displayName: 'Fake Bakery LLC',
      profile: { businessName: 'Fake Bakery LLC', address: home },
    };
    expect(NewClientForm.safeParse(business).success).toBe(true);
  });

  it('names every missing field of an Individual, each on its own field', () => {
    expect(issues({ accountType: 'INDIVIDUAL', displayName: '', email: '', phone: '' })).toEqual({
      displayName: 'Enter a name',
      email: 'Enter an email address',
      phone: 'Enter a phone number',
      'profile.address.line1': 'Enter the street address',
      'profile.address.city': 'Enter the city',
      'profile.address.state': 'Choose the state',
      'profile.address.postalCode': 'Enter the ZIP code',
    });
  });

  it('asks a Business for its Business Name too', () => {
    expect(issues({ ...individual, accountType: 'BUSINESS' })).toEqual({
      'profile.businessName': 'Enter the business name',
    });
  });

  it('checks the format of the email, phone, state and ZIP', () => {
    const bad = {
      ...individual,
      email: 'not-an-email',
      phone: '12',
      profile: { address: { ...home, state: 'ZZ', postalCode: '3030' } },
    };
    expect(Object.keys(issues(bad)).sort()).toEqual([
      'email',
      'phone',
      'profile.address.postalCode',
      'profile.address.state',
    ]);
    const zip4 = { ...individual, profile: { address: { ...home, postalCode: '30301-1234' } } };
    expect(NewClientForm.safeParse(zip4).success).toBe(true);
  });
});
