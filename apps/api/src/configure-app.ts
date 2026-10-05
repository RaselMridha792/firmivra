import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import { requestContextMiddleware } from './common/request-context.js';
import type { Env } from './config/env.js';

/** Shared by main.ts and the e2e tests, so tests run the same middleware and filters. */
export function configureApp(app: NestExpressApplication, env: Env): void {
  app.useLogger(app.get(Logger));
  app.set('trust proxy', 1); // behind the ALB and CloudFront in AWS
  app.use(requestContextMiddleware);
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: [env.APP_BASE_URL, env.PORTAL_BASE_URL, env.ADMIN_BASE_URL],
    credentials: true,
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();

  if (env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Firmivra API')
      .setVersion('0.1')
      .addBearerAuth()
      .addCookieAuth('fv_access')
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  }
}
