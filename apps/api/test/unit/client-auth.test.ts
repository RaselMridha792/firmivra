// Unit tests for R3 sign-up pieces: the code sender stand-in, phone masking, Cognito attributes.
import { describe, expect, it, vi } from 'vitest';
import {
  type CognitoClient,
  CognitoIdentityProvider,
} from '../../src/auth/identity/cognito-identity.provider.js';
import { LogClientCodeSender } from '../../src/client-auth/client-code-sender.js';
import { maskPhone } from '../../src/client-auth/sign-up.service.js';

describe('LogClientCodeSender (until R6)', () => {
  const message = { to: 'jane@example.com', code: '482913', businessName: 'LVP' };

  it('logs codes only in local mode', async () => {
    const logger = { log: vi.fn(), warn: vi.fn() };
    await new LogClientCodeSender(true, logger).emailCode(message);
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('482913'));
  });

  it('never logs a code or an address anywhere else (hard rule 4)', async () => {
    const logger = { log: vi.fn(), warn: vi.fn() };
    const sender = new LogClientCodeSender(false, logger);
    await sender.emailCode(message);
    await sender.smsCode({ ...message, to: '+17705550199' });
    await sender.alreadyRegistered({ to: 'jane@example.com', businessName: 'LVP' });
    const logged = JSON.stringify([...logger.log.mock.calls, ...logger.warn.mock.calls]);
    expect(logged).not.toContain('482913');
    expect(logged).not.toContain('jane@example.com');
    expect(logged).not.toContain('5550199');
    expect(logger.warn).toHaveBeenCalledTimes(3);
  });
});

describe('maskPhone', () => {
  it('shows only the area code and the last four digits', () => {
    expect(maskPhone('+17705550123')).toBe('(770) ***-0123');
    expect(maskPhone('+442071234567')).toBe('+44 *** 4567');
  });
});

describe('CognitoIdentityProvider: client logins', () => {
  const pool = { userPoolId: 'us-east-1_clients', clientId: 'c', clientSecret: 's' };

  function fake(handlers: Record<string, () => unknown>) {
    const sent: { command: string; input: Record<string, unknown> }[] = [];
    const send = vi.fn((cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
      const command = cmd.constructor.name.replace(/Command$/, '');
      sent.push({ command, input: cmd.input });
      return Promise.resolve(handlers[command]?.());
    });
    const provider = new CognitoIdentityProvider({ send } as unknown as CognitoClient, {
      CLIENT: pool,
    });
    return { provider, sent };
  }

  it('creates a client login with the phone, and the email not yet verified', async () => {
    const { provider, sent } = fake({
      AdminCreateUser: () => ({ User: { Attributes: [{ Name: 'sub', Value: 'client-sub' }] } }),
    });
    await expect(
      provider.createUser('CLIENT', 'jane@example.com', {
        phone: '+17705550199',
        emailVerified: false,
      }),
    ).resolves.toBe('client-sub');
    expect(sent[0]?.input['UserAttributes']).toEqual([
      { Name: 'email', Value: 'jane@example.com' },
      { Name: 'email_verified', Value: 'false' },
      { Name: 'phone_number', Value: '+17705550199' },
      { Name: 'phone_number_verified', Value: 'false' },
    ]);
    expect(sent[0]?.input['MessageAction']).toBe('SUPPRESS');
  });

  it('marks a contact verified, and a changed one unverified, on the username', async () => {
    const { provider, sent } = fake({
      ListUsers: () => ({ Users: [{ Username: 'client-user', Enabled: true }] }),
      AdminUpdateUserAttributes: () => ({}),
    });
    await provider.updateContact('CLIENT', 'client-sub', { emailVerified: true });
    await provider.updateContact('CLIENT', 'client-sub', { phone: '+14045550100' });
    const updates = sent.filter((s) => s.command === 'AdminUpdateUserAttributes');
    expect(updates.map((u) => u.input)).toEqual([
      {
        UserPoolId: pool.userPoolId,
        Username: 'client-user',
        UserAttributes: [{ Name: 'email_verified', Value: 'true' }],
      },
      {
        UserPoolId: pool.userPoolId,
        Username: 'client-user',
        UserAttributes: [
          { Name: 'phone_number', Value: '+14045550100' },
          { Name: 'phone_number_verified', Value: 'false' },
        ],
      },
    ]);
  });
});
