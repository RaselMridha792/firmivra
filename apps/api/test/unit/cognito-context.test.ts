// Unit tests for the viewer context Cognito threat protection gets (R2 step 7).
import { describe, expect, it } from 'vitest';
import { contextData } from '../../src/auth/identity/cognito-identity.provider.js';
import { requestContext } from '../../src/common/request-context.js';

const pool = { serverName: 'app.firmivra.test' } as Parameters<typeof contextData>[0];
const at = (ip: string) =>
  requestContext.run(
    { requestId: 'r1', ip, userAgent: 'Fake browser', path: '/api/v1/auth/sign-in' },
    () => contextData(pool),
  );

describe('contextData', () => {
  it("sends the viewer's IP, the host and path, and the allowlisted headers", () => {
    expect(at('203.0.113.7')).toEqual({
      IpAddress: '203.0.113.7',
      ServerName: 'app.firmivra.test',
      ServerPath: '/api/v1/auth/sign-in',
      HttpHeaders: [{ headerName: 'user-agent', headerValue: 'Fake browser' }],
    });
    expect(at('2001:db8::1')?.IpAddress).toBe('2001:db8::1');
  });

  it('sends nothing when the address is not an IP address (#84 follow-up)', () => {
    expect(at('198.21.0.300')).toBeUndefined();
    expect(at('not-an-ip')).toBeUndefined();
  });

  it('sends nothing outside a request', () => {
    expect(contextData(pool)).toBeUndefined();
  });
});
