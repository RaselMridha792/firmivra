import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { config as loadDotenv } from 'dotenv';
import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';
import { loadEnv } from './config/env.js';

async function bootstrap(): Promise<void> {
  // Local: the shared .env at the repo root. In AWS the task gets real environment variables.
  loadDotenv({ path: ['.env', '../../.env'], quiet: true });
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), {
    bufferLogs: true,
  });
  configureApp(app, env);
  await app.listen(env.API_PORT);
}

void bootstrap();
