// SES and SNS give up on a provider that accepts the connection and never answers. A local
// server on 127.0.0.1 stands in for the provider: no AWS call, synthetic credentials and
// example.test addresses only.
import { type AddressInfo, type Server, type Socket, createServer } from 'node:net';
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { SNSClient } from '@aws-sdk/client-sns';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FIRMIVRA_BRANDING } from '../../src/notify/branding.js';
import {
  AWS_CLIENT,
  NotifyDeliveryError,
  SendingNotifyService,
} from '../../src/notify/notify.service.js';
import { SesEmailTransport, SnsSmsTransport } from '../../src/notify/transports.js';
import { LINK_ORIGINS, SAMPLE_DATA } from './notify-fixtures.js';

describe('AWS clients against a provider that never answers', () => {
  let server: Server;
  const sockets = new Set<Socket>();
  let connections = 0;
  let endpoint = '';

  beforeAll(async () => {
    server = createServer((socket) => {
      // Accept, read and never answer.
      connections += 1;
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.resume();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('rejects SES and SNS sends with NotifyDeliveryError within about 10 to 12 s (2 attempts of 5 s)', async () => {
    const options = {
      ...AWS_CLIENT,
      endpoint,
      region: 'us-east-1',
      credentials: { accessKeyId: 'AKIDSYNTHETIC', secretAccessKey: 'synthetic-secret' },
    };
    const logger = { log: vi.fn(), warn: vi.fn() };
    const firm = { ...FIRMIVRA_BRANDING, name: 'Sample Tax', isFirm: true };
    const notify = new SendingNotifyService({
      branding: { load: (id) => Promise.resolve(id ? firm : FIRMIVRA_BRANDING) },
      email: {
        from: { name: 'Firmivra', address: 'no-reply@dev.example.test' },
        transport: new SesEmailTransport(new SESv2Client(options)),
      },
      sms: new SnsSmsTransport(new SNSClient(options), '+18885550100'),
      linkOrigins: LINK_ORIGINS,
      logger,
    });

    const started = Date.now();
    const timed = (send: Promise<void>) =>
      send.then(
        () => ({ error: null as unknown, ms: Date.now() - started }),
        (error: unknown) => ({ error, ms: Date.now() - started }),
      );
    const [email, sms] = await Promise.all([
      timed(
        notify.send({
          template: 'firm-application.declined',
          to: 'jordan@example.test',
          businessId: null,
          data: SAMPLE_DATA['firm-application.declined'],
        }),
      ),
      timed(
        notify.send({
          template: 'client.signup-sms-code',
          to: '+17705550199',
          businessId: '00000000-0000-4000-8000-000000000001',
          data: SAMPLE_DATA['client.signup-sms-code'],
        }),
      ),
    ]);

    for (const result of [email, sms]) {
      expect(result.error).toBeInstanceOf(NotifyDeliveryError);
      expect(result.error).toMatchObject({ reason: 'TimeoutError:ETIMEDOUT' });
      expect(result.ms).toBeGreaterThanOrEqual(9_500);
      expect(result.ms).toBeLessThan(12_500);
    }
    // Two attempts each: SES and SNS both retried once.
    expect(connections).toBe(4);
    const seen = JSON.stringify([email, sms, logger.warn.mock.calls]);
    for (const value of ['jordan@', '5550199', '482913']) expect(seen).not.toContain(value);
  }, 20_000);
});
