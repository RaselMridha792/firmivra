import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runApiSmoke } from './api-smoke.mjs';
test('smoke sends only anonymous GETs and accepts healthy registered protected routes', async () => {
  const calls = [];
  const result = await runApiSmoke({
    baseUrl: 'http://localhost:4000/api/v1',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        status: url.endsWith('/health') ? 200 : 401,
        json: async () => ({ status: 'ok', db: 'ok' }),
      };
    },
  });
  assert.ok(result.every((row) => row.ok));
  assert.equal(calls.length, 11);
  assert.ok(
    calls.every(
      ({ options }) =>
        options.method === 'GET' &&
        !options.body &&
        !options.headers.authorization &&
        !options.headers.cookie,
    ),
  );
});
test('smoke detects missing or public feature routes and refuses credential-bearing URLs', async () => {
  const result = await runApiSmoke({
    baseUrl: 'https://api.example.test/api/v1',
    fetchImpl: async (url) => ({
      status: url.endsWith('/health') ? 200 : url.endsWith('/business/team') ? 404 : 200,
      json: async () => ({ status: 'ok', db: 'ok' }),
    }),
  });
  assert.ok(result.some((row) => row.status === 404 && !row.ok));
  assert.ok(result.some((row) => row.status === 200 && !row.ok));
  await assert.rejects(runApiSmoke({ baseUrl: 'https://user:secret@api.example.test/api/v1' }));
});
