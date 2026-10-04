import { z } from 'zod';

const optional = z.string().min(1).optional();

/** Every setting the API reads. The app refuses to start when this does not validate. */
export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // Default is Cognito, so a missing value can never switch on local sign-in.
    AUTH_MODE: z.enum(['local', 'cognito']).default('cognito'),
    LOCAL_AUTH_SECRET: z.string().min(32).optional(),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL_APP: z.string().min(1),
    API_PORT: z.coerce.number().int().positive().default(4000),
    APP_BASE_URL: z.url(),
    PORTAL_BASE_URL: z.url(),
    ADMIN_BASE_URL: z.url(),
    COGNITO_REGION: z.string().default('us-east-1'),
    COGNITO_STAFF_USER_POOL_ID: optional,
    COGNITO_STAFF_CLIENT_ID: optional,
    COGNITO_CLIENTS_USER_POOL_ID: optional,
    COGNITO_CLIENTS_CLIENT_ID: optional,
    COGNITO_ADMINS_USER_POOL_ID: optional,
    COGNITO_ADMINS_CLIENT_ID: optional,
  })
  .superRefine((env, ctx) => {
    if (env.AUTH_MODE === 'local') {
      // docs/AUTH-DESIGN.md: local sign-in never runs in a deployed environment.
      if (env.NODE_ENV === 'production') {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_MODE'],
          message: 'AUTH_MODE=local is only allowed when NODE_ENV is development or test',
        });
      }
      if (!env.LOCAL_AUTH_SECRET) {
        ctx.addIssue({
          code: 'custom',
          path: ['LOCAL_AUTH_SECRET'],
          message: 'required when AUTH_MODE=local',
        });
      }
      return;
    }
    for (const key of [
      'COGNITO_STAFF_USER_POOL_ID',
      'COGNITO_STAFF_CLIENT_ID',
      'COGNITO_CLIENTS_USER_POOL_ID',
      'COGNITO_CLIENTS_CLIENT_ID',
      'COGNITO_ADMINS_USER_POOL_ID',
      'COGNITO_ADMINS_CLIENT_ID',
    ] as const) {
      if (!env[key]) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'required when AUTH_MODE=cognito' });
      }
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(raw: Record<string, string | undefined> = process.env): Env {
  // `KEY=` in .env arrives as an empty string; treat it as not set.
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== ''));
  const result = EnvSchema.safeParse(cleaned);
  if (!result.success) {
    throw new Error(`Invalid API environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
