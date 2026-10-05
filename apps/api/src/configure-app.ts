import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import { requestContextMiddleware } from './common/request-context.js';
import type { Env } from './config/env.js';

/** CloudFront and the ALB. */
export const TRUSTED_PROXY_HOPS = 2;

/** Shared by main.ts and the e2e tests, so tests run the same middleware and filters. */
export function configureApp(app: NestExpressApplication, env: Env): void {
  app.useLogger(app.get(Logger));
  // In AWS every request comes CloudFront -> ALB -> API (the ALB only takes CloudFront's
  // X-Origin-Verify header). CloudFront appends the viewer's IP to X-Forwarded-For and the ALB
  // appends CloudFront's, so the viewer is the second address from the right; anything a
  // client sends before it is ignored. req.ip (rate limits, audit log) is that viewer.
  app.set('trust proxy', TRUSTED_PROXY_HOPS);
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
