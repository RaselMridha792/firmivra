import { describe, expect, it } from 'vitest';
import { clientFormIssues, NewClientForm } from '../../src/index.js';

// Fake values only (CLAUDE.md rule 9).
const home = { line1: '1 Fake Street', city: 'Faketown', state: 'GA', postalCode: '30301' };
const individual = {
  accountType: 'INDIVIDUAL',
  displayName: 'Fake Person',
  email: 'fake.person@example.test',
  phone: '(404) 555-0100',
  profile: { address: home },
} as const;
const party = { name: 'Fake Owner', email: 'Fake.Owner@example.test', phone: '(404) 555-0101' };

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
      profile: { businessName: 'Fake Bakery LLC', address: home, responsibleParty: party },
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

  it('asks a Business for its Business Name and its responsible party too (E5)', () => {
    expect(issues({ ...individual, accountType: 'BUSINESS' })).toEqual({
      'profile.businessName': 'Enter the business name',
      'profile.responsibleParty.name': "Enter the responsible party's full name",
      'profile.responsibleParty.email': "Enter the responsible party's email",
      'profile.responsibleParty.phone': "Enter the responsible party's phone",
    });
  });

  it("checks the responsible party's email and phone, and keeps them as typed (E5)", () => {
    const business = {
      ...individual,
      accountType: 'BUSINESS',
      profile: {
        businessName: 'Fake Bakery LLC',
        address: home,
        responsibleParty: { ...party, email: 'nope', phone: '12' },
      },
    };
    expect(Object.keys(issues(business)).sort()).toEqual([
      'profile.responsibleParty.email',
      'profile.responsibleParty.phone',
    ]);
    const ok = NewClientForm.parse({
      ...business,
      profile: { ...business.profile, responsibleParty: party },
    });
    expect(ok.profile?.responsibleParty).toEqual({
      name: 'Fake Owner',
      email: 'fake.owner@example.test',
      phone: '+14045550101',
    });
    // An Individual is never asked for one.
    expect(clientFormIssues({ ...individual, profile: { address: home } })).toEqual([]);
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
