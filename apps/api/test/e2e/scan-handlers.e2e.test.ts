// R55: every prefix the scan router knows has a handler once the app has started, so a new prefix
// (or a handler left out of its module) cannot reach production as UNKNOWN, fill the dead-letter
// queue and trip its alarm again.
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import {
  SCAN_PREFIXES,
  type ScanPrefix,
  type ScanResultHandler,
  ScanResultRouter,
} from '../../src/storage/scan-queue/scan-router.js';

const fx = inject('fixtures');
let app: INestApplication;

beforeAll(async () => {
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env)],
  }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.init();
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('the scan router’s registry', () => {
  it('has a handler for every prefix in SCAN_PREFIXES, and for no other', () => {
    const router = app.get(ScanResultRouter);
    const registered = (router as unknown as { handlers: Map<ScanPrefix, ScanResultHandler> })
      .handlers;
    expect([...registered.keys()].sort()).toEqual([...SCAN_PREFIXES].sort());
    for (const [prefix, handler] of registered) expect(handler.prefix).toBe(prefix);
  });
});
