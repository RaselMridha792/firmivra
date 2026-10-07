import { describe, expect, it } from 'vitest';
import {
  CreateInviteRequest,
  MfaRequest,
  Password,
  PASSWORD_RULES,
  ResetPasswordRequest,
  SignInRequest,
  SignInResult,
} from '../../src/index.js';

const me = {
  user: {
    id: '00000000-0000-4000-a000-000000000011',
    email: 'owner@lvp.test',
    name: 'O',
    pool: 'STAFF',
  },
  memberships: [],
  clientAccounts: [],
  platformAdmin: false,
};

function failedRules(password: string): string[] {
  return PASSWORD_RULES.filter((r) => !r.test(password)).map((r) => r.id);
}

describe('Password', () => {
  it('accepts a password that meets the Cognito policy (no symbol needed)', () => {
    expect(Password.safeParse('CorrectHorse9battery').success).toBe(true);
    expect(Password.safeParse('Abcdefghijk1').success).toBe(true);
  });

  it.each([
    ['Abcdefghij1', ['length']],
    ['ABCDEFGHIJK1', ['lower']],
    ['abcdefghijk1', ['upper']],
    ['Abcdefghijkl', ['number']],
    [' Abcdefghijk1', ['edges']],
    ['Abcdefghijk1 ', ['edges']],
  ])('rejects %j: %j', (password, rules) => {
    expect(failedRules(password)).toEqual(rules);
    const result = Password.safeParse(password);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message)).toEqual(
      PASSWORD_RULES.filter((r) => rules.includes(r.id)).map((r) => r.label),
    );
  });

  it('allows spaces inside but not more than 256 characters', () => {
    expect(Password.safeParse('Correct horse 9 battery').success).toBe(true);
    expect(Password.safeParse(`Aa1${'x'.repeat(254)}`).success).toBe(false);
  });
});

describe('request schemas', () => {
  it('trims and lower-cases the email; does not apply the policy at sign-in', () => {
    expect(SignInRequest.parse({ email: ' Owner@LVP.test ', password: 'old' })).toEqual({
      email: 'owner@lvp.test',
      password: 'old',
    });
  });

  it('accepts a 6-digit code with spaces and rejects anything else', () => {
    expect(MfaRequest.parse({ session: 's', code: '123 456' }).code).toBe('123456');
    expect(MfaRequest.safeParse({ session: 's', code: '12345' }).success).toBe(false);
    expect(MfaRequest.safeParse({ session: 's', code: '12345a' }).success).toBe(false);
  });

  it('applies the policy to a new password', () => {
    const body = { email: 'a@b.test', code: '123456', password: 'short' };
    expect(ResetPasswordRequest.safeParse(body).success).toBe(false);
  });

  it('never lets an invite give the owner role', () => {
    const body = { email: 'new@lvp.test', name: 'New', role: 'OWNER' };
    expect(CreateInviteRequest.safeParse(body).success).toBe(false);
    expect(CreateInviteRequest.safeParse({ ...body, role: 'STAFF' }).success).toBe(true);
  });

  it("keeps an invite's name to the database's rule: one line, at most 120 characters", () => {
    const body = { email: 'new@lvp.test', role: 'STAFF' };
    const longest = 'x'.repeat(120);
    expect(CreateInviteRequest.parse({ ...body, name: `  ${longest}  ` }).name).toBe(longest);
    for (const name of [
      'x'.repeat(121),
      'Tab\tName',
      'Two\nLines',
      'Nul\u0000',
      'Delete\u007f',
      'Next line\u0085',
      '   ',
    ]) {
      expect([name, CreateInviteRequest.safeParse({ ...body, name }).success]).toEqual([
        name,
        false,
      ]);
    }
  });
});

describe('SignInResult', () => {
  it('parses each step', () => {
    expect(SignInResult.parse({ status: 'SIGNED_IN', me }).status).toBe('SIGNED_IN');
    expect(SignInResult.parse({ status: 'MFA_REQUIRED', session: 's' })).toEqual({
      status: 'MFA_REQUIRED',
      session: 's',
    });
    expect(SignInResult.parse({ status: 'MFA_SETUP_REQUIRED', session: 's' }).status).toBe(
      'MFA_SETUP_REQUIRED',
    );
  });

  it('rejects a step without its data', () => {
    expect(SignInResult.safeParse({ status: 'SIGNED_IN' }).success).toBe(false);
    expect(SignInResult.safeParse({ status: 'MFA_REQUIRED' }).success).toBe(false);
  });
});
