import { z } from 'zod';

/**
 * Settings of the email and SMS sender, read and checked by its own module when the app starts.
 * EMAIL_MODE=ses: Amazon SES (v2 API) from EMAIL_FROM, with the task role's permission (the
 * default, so a missing value never uses a stand-in). SES_CONFIGURATION_SET is not read: the email
 * stack makes it the identity's default set, which SES applies without the request naming it.
 * EMAIL_MODE=smtp: an SMTP server without login, i.e. Mailpit. EMAIL_MODE=log: nothing is sent,
 * the API log gets the template and the firm. Both only with NODE_ENV development or test.
 * SMS_MODE=log: texts go to the API log (template and firm only). SMS_MODE=sns: Amazon SNS from
 * SMS_ORIGINATION_NUMBER, the registered toll-free number; until that is set, texts go to the log,
 * so an environment without a registered number never fails a request over a text.
 * APP_BASE_URL, PORTAL_BASE_URL and ADMIN_BASE_URL (required with ses and smtp): a link in a message
 * may only go to one of these three origins; https, or http with NODE_ENV development or test.
 */
const E164 = /^\+[1-9]\d{6,14}$/;

const SITE_KEYS = ['APP_BASE_URL', 'PORTAL_BASE_URL', 'ADMIN_BASE_URL'] as const;

/** A site's origin (`https://app.firmivra.com`), or null when the address cannot be a site's. */
function siteOrigin(value: string, local: boolean): string | null {
  const url = URL.parse(value);
  if (!url || url.username || url.password) return null;
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
  return url.origin;
}

const Schema = z
  .object({
    // No default: the local stand-ins need NODE_ENV set to development or test, never assumed.
    NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
    EMAIL_MODE: z.enum(['ses', 'smtp', 'log']).default('ses'),
    /** `Name <address>` or `address`. Firm emails keep the address and show the firm's name. */
    EMAIL_FROM: z.string().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
    SMS_MODE: z.enum(['log', 'sns']).default('log'),
    SMS_ORIGINATION_NUMBER: z
      .string()
      .regex(E164, 'an E.164 phone number, such as +18885550100')
      .optional(),
    APP_BASE_URL: z.string().optional(),
    PORTAL_BASE_URL: z.string().optional(),
    ADMIN_BASE_URL: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const local = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
    for (const key of SITE_KEYS) {
      const value = env[key];
      if (value === undefined) {
        if (env.EMAIL_MODE !== 'log') {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `required when EMAIL_MODE=${env.EMAIL_MODE}: links in messages go only there`,
          });
        }
      } else if (siteOrigin(value, local) === null) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: local
            ? 'an http(s) address without a user name or password'
            : 'an https address without a user name or password',
        });
      }
    }
    if (env.EMAIL_MODE !== 'ses' && !local) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_MODE'],
        message: `EMAIL_MODE=${env.EMAIL_MODE} is only allowed when NODE_ENV is development or test`,
      });
    }
    if (env.EMAIL_MODE === 'smtp') {
      for (const key of ['SMTP_HOST', 'SMTP_PORT'] as const) {
        if (env[key] === undefined) {
          ctx.addIssue({ code: 'custom', path: [key], message: 'required when EMAIL_MODE=smtp' });
        }
      }
    }
    if (env.EMAIL_MODE !== 'log' && !env.EMAIL_FROM) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_FROM'],
        message: `required when EMAIL_MODE=${env.EMAIL_MODE}: the address emails are sent from`,
      });
    }
    if (env.EMAIL_FROM && !parseSender(env.EMAIL_FROM)) {
      ctx.addIssue({
        code: 'custom',
        path: ['EMAIL_FROM'],
        message: 'an email address, or a name and <address>',
      });
    }
  });

/** Who emails come from: EMAIL_FROM's address, with its name (if any) on Firmivra's own emails. */
export interface Sender {
  name: string | null;
  address: string;
}

export type EmailConfig =
  | { mode: 'ses'; from: Sender }
  | { mode: 'smtp'; from: Sender; host: string; port: number }
  | { mode: 'log' };

export type SmsConfig =
  | { mode: 'sns'; originationNumber: string }
  /** `unregistered`: SMS_MODE=sns without the registered number, so texts go to the log. */
  | { mode: 'log'; unregistered: boolean };

export interface NotifyConfig {
  email: EmailConfig;
  sms: SmsConfig;
  /** The origins of the app, portal and admin sites (those set): where message links may go. */
  linkOrigins: string[];
}

const ADDRESS = z.email();

/** `Name <address>`, `"Name" <address>`, `<address>` or `address`; null when it is none of them. */
export function parseSender(value: string): Sender | null {
  const named = /^\s*(?:"([^"]*)"|([^"<>]*?))\s*<([^<>\s]+)>\s*$/.exec(value);
  const address = named ? named[3] : value.trim();
  if (!address || !ADDRESS.safeParse(address).success) return null;
  const name = (named?.[1] ?? named?.[2] ?? '').trim();
  return { name: name || null, address };
}

export function loadNotifyConfig(
  raw: Record<string, string | undefined> = process.env,
): NotifyConfig {
  // `KEY=` in .env arrives as an empty string; treat it as not set.
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== ''));
  const result = Schema.safeParse(cleaned);
  if (!result.success) {
    throw new Error(`Invalid email and SMS settings:\n${z.prettifyError(result.error)}`);
  }
  const env = result.data;
  const from = env.EMAIL_FROM ? parseSender(env.EMAIL_FROM) : null;
  const email: EmailConfig =
    env.EMAIL_MODE === 'ses'
      ? { mode: 'ses', from: from! }
      : env.EMAIL_MODE === 'smtp'
        ? { mode: 'smtp', from: from!, host: env.SMTP_HOST!, port: env.SMTP_PORT! }
        : { mode: 'log' };
  const sms: SmsConfig =
    env.SMS_MODE === 'sns' && env.SMS_ORIGINATION_NUMBER
      ? { mode: 'sns', originationNumber: env.SMS_ORIGINATION_NUMBER }
      : { mode: 'log', unregistered: env.SMS_MODE === 'sns' };
  const local = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
  const linkOrigins = SITE_KEYS.flatMap((key) => {
    const origin = env[key] === undefined ? null : siteOrigin(env[key], local);
    return origin === null ? [] : [origin];
  });
  return { email, sms, linkOrigins: [...new Set(linkOrigins)] };
}
