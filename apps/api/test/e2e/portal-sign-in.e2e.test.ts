// End-to-end: client sign-in on a firm's portal (R3 step 5) in AUTH_MODE=local, where every
// password is the local one until reset and reset codes are 000000. Contract:
// docs/api/client-auth.yaml.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { type MeResponse, portalCookies, type SignInResult } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { AuditService } from '../../src/audit/audit.service.js';
import {
  IDENTITY_PROVIDER,
  type IdentityProvider,
} from '../../src/auth/identity/identity-provider.js';
import {
  LOCAL_PASSWORD,
  LOCAL_RESET_CODE,
} from '../../src/auth/identity/local-identity.provider.js';
import { PortalInfoService } from '../../src/client-auth/portal-info.controller.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
let app: INestApplication;
let origins: { portal: string; app: string };
const firmX = { id: '', slug: `r3-portal-x-${randomUUID().slice(0, 8)}` };
const firmY = { id: '', slug: `r3-portal-y-${randomUUID().slice(0, 8)}` };

type Status = 'PENDING_APPROVAL' | 'ACTIVE' | 'DECLINED' | 'DISABLED';
type Person = { id: string; email: string; accountId: string };
type Key =
  | 'active'
  | 'pending'
  | 'unverified'
  | 'declined'
  | 'disabled'
  | 'laterDeclined'
  | 'laterDisabled'
  | 'reset'
  | 'otherFirm';
const people = {} as Record<Key, Person>;

let lastViewer = 0;
const newViewer = () => `198.19.0.${++lastViewer}`;
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const setCookies = (res: Response): string[] => {
  const raw = res.headers['set-cookie'] as unknown;
  return Array.isArray(raw) ? (raw as string[]) : [];
};

async function asOwner<T>(
  scope: Parameters<typeof runInScope>[1],
  work: Parameters<typeof runInScope<T>>[2],
) {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, scope, work);
  } finally {
    await owner.$disconnect();
  }
}

/** A client of `firm` with a login of their own, as sign-up and approval leave them. */
async function client(
  key: Key,
  firm: { id: string },
  status: Status,
  verified: { email: boolean; phone: boolean } = { email: true, phone: true },
) {
  const id = randomUUID();
  const email = `r3-${key.toLowerCase()}-${id.slice(0, 6)}@example.com`;
  await asOwner({ kind: 'platform' }, (tx) =>
    tx.user.create({ data: { id, cognitoSub: id, pool: 'CLIENT', email, name: `Fake ${key}` } }),
  );
  const account = await asOwner({ kind: 'business', businessId: firm.id }, (tx) =>
    tx.clientAccount.create({
      data: {
        businessId: firm.id,
        userId: id,
        email,
        status,
        emailVerifiedAt: verified.email ? new Date() : null,
        phoneVerifiedAt: verified.phone ? new Date() : null,
      },
    }),
  );
  people[key] = { id, email, accountId: account.id };
}

const setStatus = (firm: { id: string }, who: Person, status: Status) =>
  asOwner({ kind: 'business', businessId: firm.id }, (tx) =>
    tx.clientAccount.update({ where: { id: who.accountId }, data: { status } }),
  );

/**
 * A browser on the portal: one viewer IP, the portal's origin on every POST, and a cookie jar.
 * The jar sends every cookie on every path (a real browser sends fewer): even so, one firm's
 * cookies must never work on another firm's routes.
 */
function browser() {
  const viewer = newViewer();
  const jar: Record<string, string> = {};
  const keep = (res: Response) => {
    for (const c of setCookies(res)) {
      const pair = c.split(';')[0] ?? '';
      const at = pair.indexOf('=');
      const [name, value] = [pair.slice(0, at), pair.slice(at + 1)];
      if (value) jar[name] = value;
      else delete jar[name];
    }
    return res;
  };
  const cookie = () =>
    Object.entries(jar)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  return {
    jar,
    post: (path: string, body?: object) => {
      const req = request(app.getHttpServer())
        .post(`/api/v1/portal/${path}`)
        .set('x-forwarded-for', `${viewer}, 10.0.0.5`)
        .set('origin', origins.portal)
        .set('cookie', cookie());
      return (body ? req.send(body) : req).then(keep);
    },
    get: (path: string) =>
      request(app.getHttpServer())
        .get(`/api/v1/portal/${path}`)
        .set('x-forwarded-for', `${viewer}, 10.0.0.5`)
        .set('cookie', cookie())
        .then(keep),
    signIn(firm: { slug: string }, who: { email: string }, password = LOCAL_PASSWORD) {
      return this.post(`${firm.slug}/auth/sign-in`, { email: who.email, password });
    },
  };
}

const signedIn = (res: Response) => {
  const body = res.body as SignInResult;
  if (body.status !== 'SIGNED_IN') throw new Error(`not signed in: ${JSON.stringify(body)}`);
  return body.me;
};

beforeAll(async () => {
  for (const firm of [firmX, firmY]) {
    firm.id = (
      await asOwner({ kind: 'platform' }, (tx) =>
        tx.business.create({ data: { slug: firm.slug, name: firm.slug, status: 'ACTIVE' } }),
      )
    ).id;
  }
  await client('active', firmX, 'ACTIVE');
  await client('pending', firmX, 'PENDING_APPROVAL');
  await client('unverified', firmX, 'PENDING_APPROVAL', { email: true, phone: false });
  await client('declined', firmX, 'DECLINED');
  await client('disabled', firmX, 'DISABLED');
  await client('laterDeclined', firmX, 'ACTIVE');
  await client('laterDisabled', firmX, 'ACTIVE');
  await client('reset', firmX, 'ACTIVE');
  await client('otherFirm', firmY, 'ACTIVE');

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  origins = {
    portal: new URL(env.PORTAL_BASE_URL).origin,
    app: new URL(env.APP_BASE_URL).origin,
  };
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env)],
  }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app as NestExpressApplication, env);
  await app.init();
});

afterAll(async () => {
  await app.close();
});

describe('portal sign-in', () => {
  it("signs an approved client in at once, with this firm's own cookies", async () => {
    const b = browser();
    const res = await b.signIn(firmX, people.active);
    expect(res.status).toBe(200);
    const me = signedIn(res);
    expect(me.user).toMatchObject({ email: people.active.email, pool: 'CLIENT' });
    expect(me.memberships).toEqual([]);
    expect(me.clientAccounts).toEqual([
      {
        status: 'ACTIVE',
        business: { id: firmX.id, slug: firmX.slug, name: firmX.slug, status: 'ACTIVE' },
      },
    ]);

    const names = portalCookies(firmX.slug);
    const cookies = setCookies(res);
    const access = cookies.find((c) => c.startsWith(`${names.access}=`));
    const refresh = cookies.find((c) => c.startsWith(`${names.refresh}=`));
    expect(access).toMatch(new RegExp(`Path=${names.accessPath};.*HttpOnly.*SameSite=Lax`, 'i'));
    // 30 days; the clock is read twice, so under load a second may tick in between.
    expect(refresh).toMatch(
      // Exactly 30 days: the cookie takes the session's full lifetime, not a second less.
      new RegExp(`Max-Age=2592000; Path=${names.refreshPath};`, 'i'),
    );
    expect(refresh).toMatch(/HttpOnly.*SameSite=Strict/i);
    // Never the firm site's cookies, and never a Domain.
    expect(cookies.some((c) => c.startsWith('fv_access=') || c.startsWith('fv_refresh='))).toBe(
      false,
    );
    for (const c of cookies) expect(c).not.toMatch(/Domain=/i);

    const again = await b.get(`${firmX.slug}/me`);
    expect(again.status).toBe(200);
    expect((again.body as MeResponse).clientAccounts).toEqual(me.clientAccounts);
  });

  it('lets a verified client who waits for the firm in, to see the waiting page', async () => {
    const b = browser();
    const me = signedIn(await b.signIn(firmX, people.pending));
    expect(me.clientAccounts.map((a) => a.status)).toEqual(['PENDING_APPROVAL']);
    const res = await b.get(`${firmX.slug}/me`);
    expect((res.body as MeResponse).clientAccounts[0]?.status).toBe('PENDING_APPROVAL');
  });

  it('answers an unfinished sign-up, declined, disabled, wrong password and unknown email alike', async () => {
    const b = browser();
    const tries: [string, { email: string }, string?][] = [
      ['unfinished sign-up', people.unverified],
      ['declined', people.declined],
      ['disabled', people.disabled],
      ['wrong password', people.active, 'Wrong-password-1'],
      ['unknown email', { email: `r3-nobody-${randomUUID().slice(0, 6)}@example.com` }],
      ['client of another firm', people.otherFirm],
    ];
    for (const [label, who, password] of tries) {
      const res = await b.signIn(firmX, who, password);
      expect([label, res.status, codeOf(res)]).toEqual([label, 401, 'INVALID_CREDENTIALS']);
      expect(setCookies(res)).toEqual([]);
    }
  });

  it('has no portal for a firm that is not active, or does not exist', async () => {
    const b = browser();
    for (const slug of [fx.suspended.slug, `r3-nowhere-${randomUUID().slice(0, 6)}`]) {
      const res = await b.signIn({ slug }, people.active);
      expect([slug, res.status, codeOf(res)]).toEqual([slug, 404, 'NOT_FOUND']);
    }
  });
});

describe("one firm's session never works on another firm's portal", () => {
  it("is signed out on firm Y's portal, even with firm X's cookies renamed", async () => {
    const b = browser();
    signedIn(await b.signIn(firmX, people.active));
    const x = portalCookies(firmX.slug);
    const y = portalCookies(firmY.slug);

    const plain = await b.get(`${firmY.slug}/me`);
    expect([plain.status, codeOf(plain)]).toEqual([401, 'UNAUTHENTICATED']);

    // Someone copies firm X's access and refresh cookies under firm Y's names.
    b.jar[y.access] = b.jar[x.access] ?? '';
    b.jar[y.refresh] = b.jar[x.refresh] ?? '';
    const copied = await b.get(`${firmY.slug}/me`);
    expect([copied.status, codeOf(copied)]).toEqual([401, 'UNAUTHENTICATED']);
    const refreshed = await b.post(`${firmY.slug}/auth/refresh`);
    expect([refreshed.status, codeOf(refreshed)]).toEqual([401, 'UNAUTHENTICATED']);

    // Firm X's own session is untouched.
    expect((await b.get(`${firmX.slug}/me`)).status).toBe(200);
  });

  it('never takes a staff or firm-site session on a portal route', async () => {
    const dev = await request(app.getHttpServer())
      .post('/api/v1/dev/token')
      .send({ email: fx.users.ownerA.email })
      .expect(200);
    const token = (dev.body as { token: string }).token;
    const viaBearer = await request(app.getHttpServer())
      .get(`/api/v1/portal/${firmX.slug}/me`)
      .set('authorization', `Bearer ${token}`);
    expect(viaBearer.status).toBe(401);
    const viaCookie = await request(app.getHttpServer())
      .get(`/api/v1/portal/${firmX.slug}/me`)
      .set('cookie', `fv_access=${token}`);
    expect(viaCookie.status).toBe(401);
  });

  it("gives a client's dev token their own portal's cookie", async () => {
    // A leftover sign-up attempt login with the same email (no account) does not get in the way.
    const leftover = randomUUID();
    await asOwner({ kind: 'platform' }, (tx) =>
      tx.user.create({
        data: {
          id: leftover,
          cognitoSub: leftover,
          pool: 'CLIENT',
          email: people.active.email,
          name: 'Leftover attempt',
        },
      }),
    );
    const dev = await request(app.getHttpServer())
      .post('/api/v1/dev/token')
      .send({ email: people.active.email })
      .expect(200);
    const names = portalCookies(firmX.slug);
    const cookies = setCookies(dev);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatch(
      new RegExp(`^${names.access}=.+; Max-Age=\\d+; Path=${names.accessPath};`),
    );
  });
});

describe('portal session', () => {
  it('refreshes while the client may sign in, and signs them out once declined', async () => {
    const b = browser();
    const who = people.laterDeclined;
    signedIn(await b.signIn(firmX, who));
    const names = portalCookies(firmX.slug);

    const ok = await b.post(`${firmX.slug}/auth/refresh`);
    expect(ok.status).toBe(200);
    expect(setCookies(ok).some((c) => c.startsWith(`${names.access}=`))).toBe(true);

    const access = b.jar[names.access] ?? '';
    await setStatus(firmX, who, 'DECLINED');
    const gone = await b.post(`${firmX.slug}/auth/refresh`);
    expect([gone.status, codeOf(gone)]).toEqual([401, 'UNAUTHENTICATED']);
    expect(setCookies(gone).join('\n')).toMatch(
      new RegExp(`^${names.refresh}=; Path=${names.refreshPath}; Expires=Thu, 01 Jan 1970`, 'm'),
    );
    // An access token from before still verifies until it expires: `me` refuses it already.
    const me = await request(app.getHttpServer())
      .get(`/api/v1/portal/${firmX.slug}/me`)
      .set('cookie', `${names.access}=${access}`);
    expect([me.status, codeOf(me)]).toEqual([401, 'UNAUTHENTICATED']);
  });

  it('signs out, clearing the cookies, also on a firm with no portal', async () => {
    const b = browser();
    signedIn(await b.signIn(firmX, people.active));
    const names = portalCookies(firmX.slug);
    const out = await b.post(`${firmX.slug}/auth/sign-out`, {});
    expect(out.body).toEqual({ ok: true });
    expect(setCookies(out).join('\n')).toMatch(
      new RegExp(`^${names.access}=; Path=${names.accessPath}; Expires=Thu, 01 Jan 1970`, 'm'),
    );
    expect(b.jar[names.access]).toBeUndefined();
    expect((await b.get(`${firmX.slug}/me`)).status).toBe(401);

    const nowhere = `r3-nowhere-${randomUUID().slice(0, 6)}`;
    const cleared = await b.post(`${nowhere}/auth/sign-out`);
    expect(cleared.body).toEqual({ ok: true });
    expect(setCookies(cleared).join('\n')).toMatch(
      new RegExp(`^${portalCookies(nowhere).refresh}=; Path=/api/v1/portal/${nowhere}/auth;`, 'm'),
    );
  });

  it('refreshes no more once the client is disabled (#62 follow-up)', async () => {
    const b = browser();
    signedIn(await b.signIn(firmX, people.laterDisabled));
    expect((await b.post(`${firmX.slug}/auth/refresh`)).status).toBe(200);
    await setStatus(firmX, people.laterDisabled, 'DISABLED');
    const gone = await b.post(`${firmX.slug}/auth/refresh`);
    expect([gone.status, codeOf(gone)]).toEqual([401, 'UNAUTHENTICATED']);
  });

  it('revokes the refresh token on sign-out after the firm is suspended (#62 follow-up)', async () => {
    const b = browser();
    signedIn(await b.signIn(firmX, people.active));
    const identity = app.get<IdentityProvider>(IDENTITY_PROVIDER);
    const revoke = vi.spyOn(identity, 'revoke');
    const setFirm = (status: 'ACTIVE' | 'SUSPENDED') =>
      asOwner({ kind: 'platform' }, (tx) =>
        tx.business.update({ where: { id: firmX.id }, data: { status } }),
      );
    await setFirm('SUSPENDED');
    try {
      const out = await b.post(`${firmX.slug}/auth/sign-out`, {});
      expect(out.body).toEqual({ ok: true });
      expect(revoke).toHaveBeenCalledTimes(1);
      expect(revoke.mock.calls[0]?.[0]).toBe('CLIENT');
      // Audited in the firm's own log, like the sign-in.
      const audit = await asOwner({ kind: 'business', businessId: firmX.id }, (tx) =>
        tx.auditLog.findFirst({
          where: { action: 'auth.signed_out', actorUserId: people.active.id },
          select: { businessId: true, metadata: true },
        }),
      );
      expect(audit).toEqual({
        businessId: firmX.id,
        metadata: { pool: 'CLIENT', everywhere: false },
      });
    } finally {
      revoke.mockRestore();
      await setFirm('ACTIVE');
    }
  });

  it('signs out, clearing the cookies, even when the firm lookup or the audit fails (#84 review)', async () => {
    const names = portalCookies(firmX.slug);
    const signOutClears = async (b: ReturnType<typeof browser>) => {
      const out = await b.post(`${firmX.slug}/auth/sign-out`, {});
      expect([out.status, out.body]).toEqual([200, { ok: true }]);
      expect(setCookies(out).join('\n')).toMatch(
        new RegExp(`^${names.refresh}=; Path=${names.refreshPath}; Expires=Thu, 01 Jan 1970`, 'm'),
      );
      expect(b.jar[names.access]).toBeUndefined();
    };

    const lookup = vi
      .spyOn(app.get(PortalInfoService), 'firmBySlug')
      .mockRejectedValueOnce(new Error('The database is down for a moment'));
    try {
      const b = browser();
      signedIn(await b.signIn(firmX, people.active));
      await signOutClears(b);
      expect(lookup).toHaveBeenCalledTimes(1);
    } finally {
      lookup.mockRestore();
    }

    const audit = app.get(AuditService);
    const log = audit.log.bind(audit);
    const failing = vi
      .spyOn(audit, 'log')
      .mockImplementation((...args: Parameters<AuditService['log']>) =>
        args[0] === 'auth.signed_out'
          ? Promise.reject(new Error('The audit insert failed'))
          : log(...args),
      );
    const revoke = vi.spyOn(app.get<IdentityProvider>(IDENTITY_PROVIDER), 'revoke');
    try {
      const b = browser();
      signedIn(await b.signIn(firmX, people.active));
      await signOutClears(b);
      expect(failing.mock.calls.some(([action]) => action === 'auth.signed_out')).toBe(true);
      // The refresh token is revoked before the audit, so a failed audit leaves no session.
      expect(revoke).toHaveBeenCalledTimes(1);
    } finally {
      failing.mockRestore();
      revoke.mockRestore();
    }
  });

  it('answers 404, not 500, for a slug that cannot be a firm address (#62 follow-up)', async () => {
    const res = await browser().post('a%3Bb/auth/sign-out', {});
    expect([res.status, codeOf(res)]).toEqual([404, 'NOT_FOUND']);
  });

  it("never takes a Super Admin's token on a portal route (#62 follow-up)", async () => {
    const dev = await request(app.getHttpServer())
      .post('/api/v1/dev/token')
      .send({ email: fx.users.admin.email })
      .expect(200);
    const token = (dev.body as { token: string }).token;
    const res = await request(app.getHttpServer())
      .get(`/api/v1/portal/${firmX.slug}/me`)
      .set('authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("clears a portal's dev cookie on dev sign-out when told the firm (#62 follow-up)", async () => {
    const names = portalCookies(firmX.slug);
    const res = await request(app.getHttpServer())
      .post('/api/v1/dev/sign-out')
      .set('origin', origins.portal)
      .send({ firmSlug: firmX.slug })
      .expect(200);
    expect(setCookies(res).join('\n')).toMatch(
      new RegExp(`^${names.access}=; Path=${names.accessPath}; Expires=Thu, 01 Jan 1970`, 'm'),
    );
    const bad = await request(app.getHttpServer())
      .post('/api/v1/dev/sign-out')
      .set('origin', origins.portal)
      .send({ firmSlug: 'a;b' });
    expect(bad.status).toBe(400);
  });

  it("takes changes only from the portal's own pages", async () => {
    const fromApp = await request(app.getHttpServer())
      .post(`/api/v1/portal/${firmX.slug}/auth/sign-in`)
      .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`)
      .set('origin', origins.app)
      .send({ email: people.active.email, password: LOCAL_PASSWORD });
    expect([fromApp.status, codeOf(fromApp)]).toEqual([403, 'ORIGIN_NOT_ALLOWED']);

    // Server code relaying the portal cookie (no Origin, no Sec-Fetch-Site) may only read.
    const relayed = await request(app.getHttpServer())
      .post(`/api/v1/portal/${firmX.slug}/auth/sign-out`)
      .set('cookie', `${portalCookies(firmX.slug).refresh}=anything`);
    expect([relayed.status, codeOf(relayed)]).toEqual([403, 'ORIGIN_NOT_ALLOWED']);
  });
});

describe('portal forgot and reset password', () => {
  it('answers every email the same, and resets only with the code, per firm', async () => {
    const b = browser();
    const who = people.reset;
    const unknown = `r3-nobody-${randomUUID().slice(0, 6)}@example.com`;
    for (const email of [who.email, unknown, people.otherFirm.email]) {
      const res = await b.post(`${firmX.slug}/auth/forgot-password`, { email });
      expect([email, res.status, res.body]).toEqual([email, 200, { ok: true }]);
    }

    const newPassword = 'Client-new-password-1';
    for (const [email, code] of [
      [who.email, '111111'],
      [unknown, LOCAL_RESET_CODE],
    ] as const) {
      const res = await b.post(`${firmX.slug}/auth/reset-password`, {
        email,
        code,
        password: newPassword,
      });
      expect([email, res.status, codeOf(res)]).toEqual([email, 400, 'RESET_CODE_INVALID']);
    }
    const reset = await b.post(`${firmX.slug}/auth/reset-password`, {
      email: who.email,
      code: LOCAL_RESET_CODE,
      password: newPassword,
    });
    expect(reset.body).toEqual({ ok: true });

    expect((await b.signIn(firmX, who)).status).toBe(401);
    signedIn(await b.signIn(firmX, who, newPassword));
  });
});
