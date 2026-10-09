import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { crossSiteGuard } from './auth/cross-site.middleware.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import { requestContextMiddleware } from './common/request-context.js';
import type { Env } from './config/env.js';

/** CloudFront and the ALB. */
export const TRUSTED_PROXY_HOPS = 2;

/**
 * The one JSON body limit (R8 step 3). Files never pass through the API (they go to S3 by
 * presigned URL). The largest valid bodies (test/e2e/hardening.e2e.test.ts builds them): a Firm
 * Sign field list (500 fields with full labels and values, about 1.1 MB in UTF-8), a signer's
 * adopted signature and initials (two base64 PNGs, about 550 KB) and a firm's Terms or Privacy
 * version (100,000 characters, about 300 KB). A raw-body route (the Stripe webhook) reads its body
 * with its own parser.
 */
export const JSON_BODY_LIMIT = '2mb';
export const JSON_BODY_LIMIT_BYTES = 2 * 1024 * 1024;

/** Swagger UI (not in production) is the only HTML the API serves; it needs scripts and styles. */
const DOCS_PATH = /^\/api\/docs(\/|$)/;

/**
 * Security headers for an API that serves only JSON: nothing may load, frame or run from a
 * response; HSTS for a year; no X-Powered-By (helmet). Swagger UI keeps helmet's default CSP.
 */
const apiHelmet = helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'none'"],
      formAction: ["'none'"],
    },
  },
  strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true },
});
const docsHelmet = helmet();

/** API responses carry firm and client data: no browser or proxy may keep a copy. */
function noStore(req: Request, res: Response, next: NextFunction): void {
  if (!DOCS_PATH.test(req.path)) res.setHeader('Cache-Control', 'no-store');
  next();
}

/** Shared by main.ts and the e2e tests, so tests run the same middleware and filters. */
export function configureApp(app: NestExpressApplication, env: Env): void {
  app.useLogger(app.get(Logger));
  // In AWS every request comes CloudFront -> ALB -> API (the ALB only takes CloudFront's
  // X-Origin-Verify header). CloudFront appends the viewer's IP to X-Forwarded-For and the ALB
  // appends CloudFront's, so the viewer is the second address from the right; anything a
  // client sends before it is ignored. req.ip (rate limits, audit log) is that viewer.
  app.set('trust proxy', TRUSTED_PROXY_HOPS);
  app.use(requestContextMiddleware);
  app.use((req: Request, res: Response, next: NextFunction) =>
    (DOCS_PATH.test(req.path) ? docsHelmet : apiHelmet)(req, res, next),
  );
  app.use(noStore);
  app.use(cookieParser());
  // Before Nest's body parsers: JSON bodies only, and browser requests from the site itself.
  // No CORS: each site calls the API on its own host (/api/v1), so no other origin needs access.
  app.use(crossSiteGuard(env));
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
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
