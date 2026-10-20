// The local /api/v1 forwarder (api-forward.ts) against a stand-in API on a free local port.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CLIENT_CLOSED, forwardToApi } from './api-forward';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
let handle: Handler = (_req, res) => res.end();
let server: Server;
let base: string;

const read = async (req: IncomingMessage) => {
  const parts: Buffer[] = [];
  for await (const part of req) parts.push(part as Buffer);
  return Buffer.concat(parts).toString('utf8');
};

beforeAll(async () => {
  server = createServer((req, res) => handle(req, res));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((done) => server.close(() => done())));
afterEach(() => vi.restoreAllMocks());

describe('forwardToApi', () => {
  it('passes the method, path, query, body and cookie through, and every Set-Cookie back', async () => {
    let seen: { method?: string; url?: string; body: string; headers: IncomingMessage['headers'] } =
      { body: '', headers: {} };
    handle = async (req, res) => {
      seen = { method: req.method, url: req.url, body: await read(req), headers: req.headers };
      res.writeHead(201, [
        ['content-type', 'application/json'],
        ['set-cookie', 'a=1; HttpOnly'],
        ['set-cookie', 'b=2; HttpOnly'],
      ]);
      res.end('{"ok":true}');
    };
    const res = await forwardToApi(
      new Request('http://app.localhost:3000/api/v1/things?x=1&y=2', {
        method: 'POST',
        headers: { cookie: 'session=fake', 'content-type': 'application/json' },
        body: '{"name":"Fake"}',
      }),
      base,
    );
    expect(seen).toMatchObject({
      method: 'POST',
      url: '/api/v1/things?x=1&y=2',
      body: '{"name":"Fake"}',
      headers: { cookie: 'session=fake', 'x-forwarded-host': 'app.localhost:3000' },
    });
    expect(res.status).toBe(201);
    expect(res.headers.getSetCookie()).toEqual(['a=1; HttpOnly', 'b=2; HttpOnly']);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('answers 499 without an error when the browser aborts before the API answers', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // The stand-in API never answers; it only notes the call.
    const arrived = new Promise<IncomingMessage>((done) => {
      handle = (req) => done(req);
    });
    const browser = new AbortController();
    const pending = forwardToApi(
      new Request('http://app.localhost:3000/api/v1/slow', { signal: browser.signal }),
      base,
    );
    const upstream = await arrived;
    const closed = new Promise<void>((done) => upstream.socket.once('close', () => done()));
    browser.abort();
    expect((await pending).status).toBe(CLIENT_CLOSED);
    // The API's connection is closed too, so it stops working on the call.
    await closed;
    expect(errors).not.toHaveBeenCalled();
  });

  it('does not follow a redirect and sends no body for 204', async () => {
    handle = (req, res) => {
      if (req.url === '/api/v1/moved') res.writeHead(302, { location: '/elsewhere' }).end();
      else res.writeHead(204).end();
    };
    const moved = await forwardToApi(new Request('http://app.localhost/api/v1/moved'), base);
    expect([moved.status, moved.headers.get('location')]).toEqual([302, '/elsewhere']);
    const empty = await forwardToApi(
      new Request('http://app.localhost/api/v1/none', { method: 'DELETE' }),
      base,
    );
    expect([empty.status, empty.body]).toEqual([204, null]);
  });

  it('answers 502 when the API is down, and 404 without API_BASE_URL', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const down = await forwardToApi(
      new Request('http://app.localhost/api/v1/health'),
      'http://127.0.0.1:1',
    );
    expect(down.status).toBe(502);
    const none = await forwardToApi(new Request('http://app.localhost/api/v1/health'), undefined);
    expect(none.status).toBe(404);
  });
});
