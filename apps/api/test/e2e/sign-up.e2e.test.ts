// End-to-end: client sign-up on a firm's portal (R3 steps 2-3) in AUTH_MODE=local, where every
// code is 000000. The ClientCodeSender is replaced by an outbox. Contract: docs/api/client-auth.yaml.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { portalCookies, SignUpState } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { CLIENT_CODE_SENDER } from '../../src/client-auth/client-code-sender.js';
import { SIGN_UP_LIMITS } from '../../src/client-auth/sign-up.service.js';
import { CODE_LIMITS } from '../../src/client-auth/verification-codes.service.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
let app: INestApplication;
const slug = `r3-signup-${randomUUID().slice(0, 8)}`;
let firmId = '';
const docIds: string[] = [];
type Sent = { kind: 'email' | 'sms' | 'registered'; to: string; code?: string };
const outbox: Sent[] = [];
/** The portal's own origin: the browser sends it on every POST (cross-site check). */
let portalOrigin = '';

let lastViewer = 0;
let lastPhone = 1000;
/** A fresh US number per sign-up, so no single number reaches its daily SMS cap here. */
const phoneFor = () => `+1770555${++lastPhone}`;
/** Each visitor on its own /24 network, so the per-network limit only applies where tested. */
const newViewer = () => `198.18.${++lastViewer}.1`;
const base = (s = slug) => `/api/v1/portal/${s}/auth/sign-up`;
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const emailFor = (name: string) => `r3-${name}-${randomUUID().slice(0, 6)}@example.com`;
/** The sealed sign-up cookie a response set (its value only). */
const cookieValue = (res: Response) =>
  ((res.headers['set-cookie'] as unknown as string[] | undefined) ?? [])
    .find((c) => c.startsWith(`${portalCookies(slug).signUp}=`))
    ?.split(';')[0]
    ?.split('=')
    .slice(1)
    .join('=');
/** An email whose sign-up at the firm is finished (email and phone verified). */
async function registeredEmail(): Promise<string> {
  const email = emailFor('known');
  const v = visitor();
  await v.signUp(form(email));
  await v.post('/verify-email', { code: '000000' });
  await v.post('/verify-phone', { code: '000000' });
  return email;
}
/** Runs `work` with no resend gap, as if 45 s had passed between the steps. */
async function withoutGap<T>(work: () => Promise<T>): Promise<T> {
  const gap = CODE_LIMITS.resendGapMs;
  CODE_LIMITS.resendGapMs = 0;
  try {
    return await work();
  } finally {
    CODE_LIMITS.resendGapMs = gap;
  }
}

/** A browser on the sign-up pages: one viewer, one cookie jar, the portal's origin. */
function visitor(firmSlug = slug, viewer = newViewer()) {
  let cookie = '';
  const keep = (res: Response) => {
    const raw = res.headers['set-cookie'] as unknown;
    const set = (Array.isArray(raw) ? (raw as string[]) : []).find((c) =>
      c.startsWith(`${portalCookies(firmSlug).signUp}=`),
    );
    if (set) cookie = set.split(';')[0] ?? '';
    return res;
  };
  const send = (method: 'get' | 'post', path: string, body?: object) => {
    let req = request(app.getHttpServer())
      [method](`${base(firmSlug)}${path}`)
      .set('x-forwarded-for', `${viewer}, 10.0.0.5`)
      .set('cookie', cookie);
    if (method === 'post') req = req.set('origin', portalOrigin);
    return (body ? req.send(body) : req).then(keep);
  };
  return {
    signUp: (body: object) => send('post', '', body),
    state: () => send('get', ''),
    post: (path: string, body: object) => send('post', path, body),
    get cookie() {
      return cookie;
    },
    set cookie(value: string) {
      cookie = value;
    },
  };
}

const form = (email: string, fields: Record<string, unknown> = {}) => ({
  name: 'Jane Client',
  email,
  phone: phoneFor(),
  password: 'Client-password-1',
  accountType: 'INDIVIDUAL',
  accepted: { termsVersion: 1, privacyVersion: 1 },
  ...fields,
});

async function asOwner<T>(
  scope: Parameters<typeof runInScope>[1],
  work: Parameters<typeof runInScope<T>>[2],
) {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  try {
    return await runInScope(owner, scope, work);
  } finally {
    await owner.$disconnect();
  }
}

beforeAll(async () => {
  firmId = (
    await asOwner({ kind: 'platform' }, (tx) =>
      tx.business.create({ data: { slug, name: 'R3 Sign-up Firm', status: 'ACTIVE' } }),
    )
  ).id;
  await asOwner({ kind: 'business', businessId: firmId }, async (tx) => {
    for (const kind of ['TERMS', 'PRIVACY'] as const) {
      const doc = await tx.firmLegalDocument.create({
        data: {
          businessId: firmId,
          kind,
          version: 1,
          body: `# ${kind}`,
          publishedByUserId: fx.users.ownerA.id,
        },
      });
      docIds.push(doc.id);
    }
  });

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  portalOrigin = new URL(env.PORTAL_BASE_URL).origin;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(CLIENT_CODE_SENDER)
    .useValue({
      emailCode: (m: { to: string; code: string }) => {
        outbox.push({ kind: 'email', to: m.to, code: m.code });
        return Promise.resolve();
      },
      smsCode: (m: { to: string; code: string }) => {
        outbox.push({ kind: 'sms', to: m.to, code: m.code });
        return Promise.resolve();
      },
      alreadyRegistered: (m: { to: string }) => {
        outbox.push({ kind: 'registered', to: m.to });
        return Promise.resolve();
      },
    })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.init();
  app = nest;
});

afterAll(async () => {
  await app.close();
});

const sentTo = (to: string) => outbox.filter((m) => m.to === to).map((m) => m.kind);

describe('client sign-up', () => {
  it('signs up, verifies the email then the phone, and waits for the firm', async () => {
    const email = emailFor('happy');
    const v = visitor();
    const res = await v
      .signUp(form(email.toUpperCase(), { accountType: 'BUSINESS', phone: '+1 (770) 555-0199' }))
      .then((r) => r);
    expect(res.status).toBe(200);
    expect(SignUpState.parse(res.body)).toMatchObject({
      step: 'VERIFY_EMAIL',
      email,
      phoneMasked: '(770) ***-0199',
    });
    const raw = (res.headers['set-cookie'] as unknown as string[]).join('\n');
    expect(raw).toMatch(
      new RegExp(
        `^${portalCookies(slug).signUp}=.*; Path=/api/v1/portal/${slug}/auth/sign-up;.*HttpOnly.*SameSite=Strict`,
        'm',
      ),
    );
    expect(outbox.filter((m) => m.to === email)).toEqual([
      { kind: 'email', to: email, code: '000000' },
    ]);

    expect((await v.state()).body).toMatchObject({ step: 'VERIFY_EMAIL' });
    expect(codeOf(await v.post('/verify-phone', { code: '000000' }))).toBe('WRONG_STEP');
    expect(codeOf(await v.post('/verify-email', { code: '111111' }))).toBe('CODE_INVALID');
    expect((await v.post('/verify-email', { code: '000 000' })).body).toMatchObject({
      step: 'VERIFY_PHONE',
    });
    expect(outbox.at(-1)).toEqual({ kind: 'sms', to: '+17705550199', code: '000000' });
    expect(codeOf(await v.post('/resend', { channel: 'phone' }))).toBe('RATE_LIMITED');
    expect(codeOf(await v.post('/change-email', { email: emailFor('late') }))).toBe(
      'ALREADY_VERIFIED',
    );
    expect((await v.post('/verify-phone', { code: '000000' })).body).toMatchObject({
      step: 'DONE',
      resendAvailableAt: null,
    });

    const account = await asOwner({ kind: 'business', businessId: firmId }, (tx) =>
      tx.clientAccount.findFirstOrThrow({
        where: { email },
        include: { user: true },
      }),
    );
    expect(account).toMatchObject({ status: 'PENDING_APPROVAL', accountType: 'BUSINESS' });
    expect(account.emailVerifiedAt).not.toBeNull();
    expect(account.phoneVerifiedAt).not.toBeNull();
    expect(account.user).toMatchObject({
      pool: 'CLIENT',
      name: 'Jane Client',
      phone: '+17705550199',
    });
    const [acceptances, audits] = await asOwner({ kind: 'business', businessId: firmId }, (tx) =>
      Promise.all([
        tx.legalAcceptance.findMany({ where: { clientAccountId: account.id } }),
        tx.auditLog.findMany({ where: { entityId: account.id }, orderBy: { createdAt: 'asc' } }),
      ]),
    );
    expect(acceptances.map((a) => a.legalDocumentId).sort()).toEqual([...docIds].sort());
    expect(audits.map((a) => [a.action, a.businessId, a.actorUserId])).toEqual([
      ['client_account.signed_up', firmId, account.userId],
      ['client_account.email_verified', firmId, account.userId],
      ['client_account.verified', firmId, account.userId],
    ]);
  });

  it('answers an email that already has an account here exactly like a new one', async () => {
    const email = emailFor('taken');
    const first = visitor();
    await first.signUp(form(email));
    await first.post('/verify-email', { code: '000000' });
    await first.post('/verify-phone', { code: '000000' });

    const fresh = await visitor().signUp(form(emailFor('fresh')));
    const v = visitor();
    const again = await v.signUp(form(email, { name: 'Someone Else' }));
    expect(again.status).toBe(fresh.status);
    expect(Object.keys(again.body as object).sort()).toEqual(
      Object.keys(fresh.body as object).sort(),
    );
    // The same cookie, to the character count (both emails have the same length).
    expect(cookieValue(again)?.length).toBe(cookieValue(fresh)?.length);
    expect(again.body).toMatchObject({ step: 'VERIFY_EMAIL', email });
    expect(sentTo(email)).toEqual(['email', 'registered']);
    // The session goes nowhere: no code ever matches.
    expect(codeOf(await v.post('/verify-email', { code: '000000' }))).toBe('CODE_INVALID');
    const count = await asOwner({ kind: 'business', businessId: firmId }, (tx) =>
      tx.clientAccount.count({ where: { email } }),
    );
    expect(count).toBe(1);
  });

  it('stops after 5 wrong tries: the sign-up ends at CONTACT_FIRM (q13)', async () => {
    const v = visitor();
    await v.signUp(form(emailFor('guess')));
    for (let i = 0; i < 5; i += 1) {
      expect(codeOf(await v.post('/verify-email', { code: '111111' }))).toBe('CODE_INVALID');
    }
    expect(codeOf(await v.post('/verify-email', { code: '000000' }))).toBe('WRONG_STEP');
    expect((await v.state()).body).toMatchObject({ step: 'CONTACT_FIRM', resendAvailableAt: null });
  });

  it('counts parallel guesses one by one: at most 5 comparisons, no errors', async () => {
    const email = emailFor('parallel');
    const v = visitor();
    await v.signUp(form(email));
    const guesses = await Promise.all(
      Array.from({ length: 9 }, () => v.post('/verify-email', { code: '111111' })),
    );
    // Each is a wrong code or, once 5 are recorded, the end of the sign-up; never a 500.
    for (const g of guesses) {
      expect([
        [400, 'CODE_INVALID'],
        [409, 'WRONG_STEP'],
      ]).toContainEqual([g.status, codeOf(g)]);
    }
    const attempts = await asOwner({ kind: 'business', businessId: firmId }, (tx) =>
      tx.verificationCode.findFirstOrThrow({
        where: { target: email },
        select: { attempts: true },
      }),
    );
    expect(attempts.attempts).toBe(5);
    expect(codeOf(await v.post('/verify-email', { code: '000000' }))).toBe('WRONG_STEP');
  });

  it('waits out the resend gap for a changed email, and old codes stop working', async () => {
    const v = visitor();
    await v.signUp(form(emailFor('typo')));
    const fixed = emailFor('fixed');
    // Within the gap the address changes, but no code is sent yet.
    expect((await v.post('/change-email', { email: fixed })).body).toMatchObject({
      step: 'VERIFY_EMAIL',
      email: fixed,
    });
    expect(sentTo(fixed)).toEqual([]);
    // The code sent to the first address no longer verifies anything.
    expect(codeOf(await v.post('/verify-email', { code: '000000' }))).toBe('CODE_INVALID');
    expect(codeOf(await v.post('/resend', { channel: 'email' }))).toBe('RATE_LIMITED');

    await withoutGap(async () => {
      await v.post('/resend', { channel: 'email' });
    });
    expect(sentTo(fixed)).toEqual(['email']);
    expect((await v.post('/verify-email', { code: '000000' })).body).toMatchObject({
      step: 'VERIFY_PHONE',
      email: fixed,
    });
  });

  it('sets the cookie the same way on every path: resend and change-email', async () => {
    const taken = emailFor('known');
    const owner = visitor();
    await owner.signUp(form(taken));
    await owner.post('/verify-email', { code: '000000' });
    await owner.post('/verify-phone', { code: '000000' });

    await withoutGap(async () => {
      for (const email of [taken, emailFor('other')]) {
        const v = visitor();
        await v.signUp(form(email));
        const resent = await v.post('/resend', { channel: 'email' });
        expect([email, resent.status, cookieValue(resent) !== undefined]).toEqual([
          email,
          200,
          true,
        ]);
        const changed = await v.post('/change-email', { email: emailFor('moved') });
        expect([email, changed.status, cookieValue(changed) !== undefined]).toEqual([
          email,
          200,
          true,
        ]);
      }
    });
  });

  it('limits sign-ups per email per network per day, and code requests per session, alike for every email', async () => {
    const taken = emailFor('limit');
    const first = visitor();
    await first.signUp(form(taken));
    await first.post('/verify-email', { code: '000000' });
    // Per email from one network: someone elsewhere is not blocked by it.
    for (const [n, email] of [
      [1, taken],
      [2, emailFor('limitnew')],
    ] as const) {
      const network = (i: number) => `203.0.${n}.${i + 1}`;
      for (let i = 0; i < SIGN_UP_LIMITS.perEmailNetworkPerDay; i += 1) {
        expect((await visitor(slug, network(i)).signUp(form(email))).status).toBe(200);
      }
      const over = await visitor(slug, network(9)).signUp(form(email));
      expect([email, over.status, codeOf(over)]).toEqual([email, 429, 'RATE_LIMITED']);
      expect((await visitor().signUp(form(email))).status).toBe(200);
    }
    // Per email overall, from any network: only a warning, once a day, never a block (#70 review).
    const emailAlert = SIGN_UP_LIMITS.emailAlertPerDay;
    SIGN_UP_LIMITS.emailAlertPerDay = 2;
    try {
      const busy = emailFor('limitall');
      for (let i = 0; i < 4; i += 1) {
        expect((await visitor().signUp(form(busy))).status).toBe(200);
      }
      const alerts = await asOwner({ kind: 'business', businessId: firmId }, (tx) =>
        tx.auditLog.findMany({
          where: { businessId: firmId, action: 'client_auth.sign_up_alert' },
          select: { metadata: true },
        }),
      );
      const forEmail = alerts.filter((a) => (a.metadata as { kind?: string }).kind === 'email');
      // Four sign-ups past a level of 2: one warning for that email.
      expect(forEmail).toHaveLength(1);
      expect(JSON.stringify(forEmail)).not.toContain(busy);
    } finally {
      SIGN_UP_LIMITS.emailAlertPerDay = emailAlert;
    }

    await withoutGap(async () => {
      const v = visitor();
      await v.signUp(form(emailFor('sends')));
      for (let i = 1; i < SIGN_UP_LIMITS.sendsPerSession; i += 1) {
        expect((await v.post('/resend', { channel: 'email' })).status).toBe(200);
      }
      expect(codeOf(await v.post('/resend', { channel: 'email' }))).toBe('RATE_LIMITED');
    });
  });

  it('refuses outdated terms, a closed or unknown firm, and a weak password', async () => {
    const v = visitor();
    const outdated = await v.signUp(
      form(emailFor('old'), { accepted: { termsVersion: 2, privacyVersion: 1 } }),
    );
    expect([outdated.status, codeOf(outdated)]).toEqual([409, 'TERMS_OUTDATED']);
    const closed = await visitor(fx.firmB.slug).signUp(form(emailFor('closed')));
    expect([closed.status, codeOf(closed)]).toEqual([403, 'SIGN_UP_CLOSED']);
    expect((await visitor('no-such-firm').signUp(form(emailFor('none')))).status).toBe(404);
    const weak = await v.signUp(form(emailFor('weak'), { password: 'weak' }));
    expect([weak.status, codeOf(weak)]).toEqual([400, 'VALIDATION_FAILED']);
  });

  it('limits sign-ups and code requests per IP per hour, across emails (SMS cost guard)', async () => {
    const ip = newViewer();
    await withoutGap(async () => {
      const v = visitor(slug, ip);
      await v.signUp(form(emailFor('ipone')));
      for (let i = 1; i < SIGN_UP_LIMITS.perIpPerHour; i += 1) {
        expect((await v.post('/resend', { channel: 'email' })).status).toBe(200);
      }
    });
    // The 11th request from that IP, even for another email, waits; another IP does not.
    const again = await visitor(slug, ip).signUp(form(emailFor('iptwo')));
    expect([again.status, codeOf(again)]).toEqual([429, 'RATE_LIMITED']);
    expect((await visitor().signUp(form(emailFor('ipthree')))).status).toBe(200);
  });

  it('takes only US phone numbers', async () => {
    const res = await visitor().signUp(form(emailFor('abroad'), { phone: '+1 876 555 0100' }));
    expect([res.status, codeOf(res)]).toEqual([400, 'VALIDATION_FAILED']);
  });

  it("never takes over an account that isn't an unfinished sign-up", async () => {
    // An ACTIVE client the firm added, with no verified email on record (like a seeded one).
    const id = randomUUID();
    const email = emailFor('active');
    await asOwner({ kind: 'platform' }, (tx) =>
      tx.user.create({
        data: {
          id,
          cognitoSub: id,
          pool: 'CLIENT',
          email,
          name: 'Real Client',
          phone: '+17705550111',
        },
      }),
    );
    await asOwner({ kind: 'business', businessId: firmId }, (tx) =>
      tx.clientAccount.create({
        data: { businessId: firmId, userId: id, email, status: 'ACTIVE' },
      }),
    );
    const v = visitor();
    const res = await v.signUp(form(email, { name: 'Attacker', phone: '+14045550100' }));
    expect(res.status).toBe(200);
    expect(codeOf(await v.post('/verify-email', { code: '000000' }))).toBe('CODE_INVALID');
    const account = await asOwner({ kind: 'business', businessId: firmId }, (tx) =>
      tx.clientAccount.findFirstOrThrow({ where: { email }, include: { user: true } }),
    );
    expect(account.userId).toBe(id);
    expect(account.user).toMatchObject({ name: 'Real Client', phone: '+17705550111' });
    expect(sentTo(email)).toEqual(['registered']);
  });

  it("a second sign-up over someone's pending one never gets the account", async () => {
    const email = emailFor('victim');
    const victim = visitor();
    await victim.signUp(form(email, { name: 'Victim', phone: '+1 (770) 555-0199' }));
    // The attacker signs up with the same email, inside the resend gap.
    const attacker = visitor();
    await attacker.signUp(form(email, { name: 'Attacker', phone: '+14045550100' }));
    // The victim verifies their email; the attacker then tries the phone step.
    expect((await victim.post('/verify-email', { code: '000000' })).body).toMatchObject({
      step: 'VERIFY_PHONE',
    });
    expect(codeOf(await attacker.post('/verify-phone', { code: '000000' }))).toBe('WRONG_STEP');
    expect(codeOf(await attacker.post('/verify-email', { code: '000000' }))).toBe('CODE_INVALID');
    expect((await attacker.state()).body).toMatchObject({ step: 'VERIFY_EMAIL' });
    const account = await asOwner({ kind: 'business', businessId: firmId }, (tx) =>
      tx.clientAccount.findFirstOrThrow({ where: { email }, include: { user: true } }),
    );
    expect(account.user).toMatchObject({ name: 'Victim', phone: '+17705550199' });
    expect((await victim.post('/verify-phone', { code: '000000' })).body).toMatchObject({
      step: 'DONE',
    });
  });

  it("an attacker's newer code never verifies for the victim, and the victim still wins", async () => {
    const email = emailFor('race');
    const victim = visitor();
    await victim.signUp(form(email, { name: 'Victim', phone: '+1 (770) 555-0199' }));
    await withoutGap(async () => {
      const attacker = visitor();
      await attacker.signUp(form(email, { name: 'Attacker' }));
      // The newest code is the attacker's attempt's: the victim's code no longer works.
      expect(codeOf(await victim.post('/verify-email', { code: '000000' }))).toBe('CODE_INVALID');
      await victim.post('/resend', { channel: 'email' });
      expect((await victim.post('/verify-email', { code: '000000' })).body).toMatchObject({
        step: 'VERIFY_PHONE',
      });
      expect(codeOf(await attacker.post('/verify-email', { code: '000000' }))).toBe('CODE_INVALID');
    });
    const account = await asOwner({ kind: 'business', businessId: firmId }, (tx) =>
      tx.clientAccount.findFirstOrThrow({ where: { email }, include: { user: true } }),
    );
    expect(account.user.name).toBe('Victim');
  });

  it('lets the owner of an abandoned sign-up start again, and retires the old login', async () => {
    const email = emailFor('restart');
    const abandoned = visitor();
    await abandoned.signUp(form(email, { name: 'First Try' }));
    const before = await asOwner({ kind: 'business', businessId: firmId }, (tx) =>
      tx.clientAccount.findFirstOrThrow({ where: { email }, select: { id: true, userId: true } }),
    );
    await withoutGap(async () => {
      const again = visitor();
      await again.signUp(form(email, { name: 'Second Try', phone: '+14045550100' }));
      expect((await again.post('/verify-email', { code: '000000' })).body).toMatchObject({
        step: 'VERIFY_PHONE',
        phoneMasked: '(404) ***-0100',
      });
    });
    const after = await asOwner({ kind: 'business', businessId: firmId }, (tx) =>
      tx.clientAccount.findFirstOrThrow({ where: { email }, include: { user: true } }),
    );
    expect(after.id).toBe(before.id);
    expect(after.user).toMatchObject({ name: 'Second Try', phone: '+14045550100' });
    const oldLogin = await asOwner({ kind: 'platform' }, (tx) =>
      tx.user.findUnique({ where: { id: before.userId } }),
    );
    expect(oldLogin).toBeNull();
    // The first attempt's login is gone, so its cookie has expired.
    expect(codeOf(await abandoned.post('/verify-phone', { code: '000000' }))).toBe(
      'SIGN_UP_EXPIRED',
    );
  });

  it('shows the same resend time on every path, from the server (#51 re-review)', async () => {
    const taken = emailFor('oracle');
    const owner = visitor();
    await owner.signUp(form(taken));
    await owner.post('/verify-email', { code: '000000' });
    await owner.post('/verify-phone', { code: '000000' });
    // A second sign-up inside the gap: a new email and a registered one show the same wait.
    const fresh = await visitor().signUp(form(emailFor('oraclex')));
    const known = await visitor().signUp(form(taken));
    const wait = (r: Response) =>
      Date.parse((r.body as { resendAvailableAt: string }).resendAvailableAt) - Date.now();
    expect(Math.abs(wait(fresh) - wait(known))).toBeLessThan(2_000);
    expect(wait(known)).toBeGreaterThan(40_000);
  });

  it('sends nothing on a change of email inside the gap, on every path (#51 re-review)', async () => {
    const registered = emailFor('regd');
    const done = visitor();
    await done.signUp(form(registered));
    await done.post('/verify-email', { code: '000000' });
    await done.post('/verify-phone', { code: '000000' });
    const unfinishedEmail = emailFor('unfin');
    await visitor().signUp(form(unfinishedEmail));
    const sentBefore = outbox.length;
    for (const target of [emailFor('newone'), registered, unfinishedEmail]) {
      const v = visitor();
      await v.signUp(form(emailFor('start')));
      const start = outbox.length;
      const res = await v.post('/change-email', { email: target });
      expect([target, res.status]).toEqual([target, 200]);
      expect([target, outbox.length - start]).toEqual([target, 0]);
    }
    expect(outbox.length).toBeGreaterThan(sentBefore);
  });

  it('keeps the gap and the request count on the server: an older cookie resets nothing', async () => {
    for (const email of [emailFor('replaynew'), await registeredEmail()]) {
      const v = visitor();
      await v.signUp(form(email));
      const firstCookie = v.cookie;
      await withoutGap(async () => {
        expect((await v.post('/resend', { channel: 'email' })).status).toBe(200);
      });
      // Replay the first cookie: the gap from the resend just now still holds, on both paths.
      v.cookie = firstCookie;
      const replayed = await v.post('/resend', { channel: 'email' });
      expect([email, replayed.status, codeOf(replayed)]).toEqual([email, 429, 'RATE_LIMITED']);
    }
  });

  it("answers SIGN_UP_EXPIRED, not 500, for a taken-over attempt's cookie (#51 re-review)", async () => {
    const email = emailFor('retired');
    const first = visitor();
    await first.signUp(form(email));
    await withoutGap(async () => {
      const again = visitor();
      await again.signUp(form(email));
      await again.post('/verify-email', { code: '000000' });
    });
    for (const [path, body] of [
      ['/change-phone', { phone: '+14045550123' }],
      ['/change-email', { email: emailFor('elsewhere') }],
    ] as const) {
      const res = await first.post(path, body);
      expect([path, res.status, codeOf(res)]).toEqual([path, 410, 'SIGN_UP_EXPIRED']);
    }
  });

  it('answers CODE_INVALID, not 500, when a replayed cookie would give one login two accounts', async () => {
    const pending = emailFor('pend');
    await visitor().signUp(form(pending));
    const v = visitor();
    await withoutGap(async () => {
      await v.signUp(form(pending)); // this attempt is for the unfinished account
      const forPending = v.cookie;
      await v.post('/change-email', { email: emailFor('ownnew') }); // it now owns a new account
      v.cookie = forPending;
      const res = await v.post('/verify-email', { code: '000000' });
      expect([res.status, codeOf(res)]).toEqual([400, 'CODE_INVALID']);
    });
  });

  it('limits one network per hour, and only logs a busy firm instead of closing it', async () => {
    const perNetwork = SIGN_UP_LIMITS.perNetworkPerHour;
    const firmAlert = SIGN_UP_LIMITS.firmAlertPerDay;
    SIGN_UP_LIMITS.perNetworkPerHour = 3;
    SIGN_UP_LIMITS.firmAlertPerDay = 1;
    try {
      for (let i = 1; i <= 3; i += 1) {
        expect((await visitor(slug, `192.0.2.${i}`).signUp(form(emailFor('net')))).status).toBe(
          200,
        );
      }
      const over = await visitor(slug, '192.0.2.9').signUp(form(emailFor('net')));
      expect([over.status, codeOf(over)]).toEqual([429, 'RATE_LIMITED']);
      // Another network still signs up, far past the firm's alert level.
      expect((await visitor().signUp(form(emailFor('netother')))).status).toBe(200);
      expect((await visitor().signUp(form(emailFor('netother')))).status).toBe(200);
      // The busy firm is warned about once a day, however many sign-ups follow.
      const alerts = await asOwner({ kind: 'business', businessId: firmId }, (tx) =>
        tx.auditLog.count({
          where: {
            businessId: firmId,
            action: 'client_auth.sign_up_alert',
            metadata: { path: ['kind'], equals: 'firm' },
          },
        }),
      );
      expect(alerts).toBe(1);
    } finally {
      SIGN_UP_LIMITS.perNetworkPerHour = perNetwork;
      SIGN_UP_LIMITS.firmAlertPerDay = firmAlert;
    }
  });

  it('holds every limit under parallel requests: no extra passes, no 500 (#70 review)', async () => {
    const perNetwork = SIGN_UP_LIMITS.perNetworkPerHour;
    SIGN_UP_LIMITS.perNetworkPerHour = 5;
    try {
      // 20 sign-ups at once from 20 addresses of one /24: exactly the network's 5 pass.
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          visitor(slug, `100.64.7.${i + 1}`).signUp(form(emailFor('burst'))),
        ),
      );
      // A busy network key is refused like the limit (try-locks), so at most 5 pass, never a 500.
      const statuses = results.map((r) => r.status);
      const passed = statuses.filter((x) => x === 200).length;
      expect(passed).toBeGreaterThanOrEqual(1);
      expect(passed).toBeLessThanOrEqual(5);
      expect(statuses.filter((x) => x !== 200 && x !== 429)).toEqual([]);
    } finally {
      SIGN_UP_LIMITS.perNetworkPerHour = perNetwork;
    }
    // One email 12 times at once from one network: exactly 5 a day pass.
    const email = emailFor('burstmail');
    const same = await Promise.all(
      Array.from({ length: 12 }, (_, i) => visitor(slug, `100.64.8.${i + 1}`).signUp(form(email))),
    );
    const sameStatuses = same.map((r) => r.status);
    const samePassed = sameStatuses.filter((x) => x === 200).length;
    expect(samePassed).toBeGreaterThanOrEqual(1);
    expect(samePassed).toBeLessThanOrEqual(SIGN_UP_LIMITS.perEmailNetworkPerDay);
    expect(sameStatuses.filter((x) => x !== 200 && x !== 429)).toEqual([]);
  });

  it('answers a burst bigger than the pool with 429s, never 500, and other firms stay up (#70 re-review)', async () => {
    const otherFirmInfo = () =>
      request(app.getHttpServer()).get(`/api/v1/portal/${fx.firmA.slug}/info`);
    const [burst, others] = await Promise.all([
      Promise.all(
        Array.from({ length: 120 }, (_, i) =>
          visitor(slug, `100.65.9.${(i % 250) + 1}`).signUp(form(emailFor('flood'))),
        ),
      ),
      Promise.all(Array.from({ length: 15 }, () => otherFirmInfo())),
    ]);
    const statuses = burst.map((r) => r.status);
    expect(statuses.filter((x) => x !== 200 && x !== 429)).toEqual([]);
    expect(statuses.filter((x) => x === 200).length).toBeLessThanOrEqual(
      SIGN_UP_LIMITS.perNetworkPerHour,
    );
    expect(others.map((r) => r.status)).toEqual(Array<number>(15).fill(200));
  });

  it('resumes a sign-up stopped after the email step, once the email is proved again (#70 re-review)', async () => {
    const email = emailFor('resume');
    const first = visitor();
    await first.signUp(form(email));
    await first.post('/verify-email', { code: '000000' });
    // The tab closes before the SMS code. A new sign-up for the same email goes on.
    await withoutGap(async () => {
      const again = visitor();
      const started = await again.signUp(form(email, { name: 'Same Person' }));
      expect(started.body).toMatchObject({ step: 'VERIFY_EMAIL' });
      expect(sentTo(email)).not.toContain('registered');
      // Not before the email is proved again by this attempt.
      expect(codeOf(await again.post('/verify-phone', { code: '000000' }))).toBe('WRONG_STEP');
      expect((await again.post('/verify-email', { code: '000000' })).body).toMatchObject({
        step: 'VERIFY_PHONE',
      });
      expect((await again.post('/verify-phone', { code: '000000' })).body).toMatchObject({
        step: 'DONE',
      });
    });
    // The first attempt's login was retired with its cookie.
    expect(codeOf(await first.state())).toBe('SIGN_UP_EXPIRED');
    const account = await asOwner({ kind: 'business', businessId: firmId }, (tx) =>
      tx.clientAccount.findFirstOrThrow({ where: { email }, include: { user: true } }),
    );
    expect(account.user.name).toBe('Same Person');
    expect(account.phoneVerifiedAt).not.toBeNull();
  });

  it('sends the first SMS even after the attempt used its requests, and shows the real wait (#70 re-review)', async () => {
    const perIp = SIGN_UP_LIMITS.perIpPerHour;
    SIGN_UP_LIMITS.perIpPerHour = 50;
    try {
      await withoutGap(async () => {
        const v = visitor();
        await v.signUp(form(emailFor('usedup')));
        for (let i = 1; i < SIGN_UP_LIMITS.sendsPerSession; i += 1) {
          expect((await v.post('/resend', { channel: 'email' })).status).toBe(200);
        }
        const before = outbox.filter((m) => m.kind === 'sms').length;
        const verified = await v.post('/verify-email', { code: '000000' });
        expect(verified.body).toMatchObject({ step: 'VERIFY_PHONE' });
        expect(outbox.filter((m) => m.kind === 'sms').length).toBe(before + 1);
        // No request left in this attempt: Resend works again only after the sign-up ends.
        const wait =
          Date.parse((verified.body as { resendAvailableAt: string }).resendAvailableAt) -
          Date.now();
        expect(wait).toBeGreaterThan(20 * 60_000);
      });
    } finally {
      SIGN_UP_LIMITS.perIpPerHour = perIp;
    }

    // An IP at its hourly limit: no SMS, and the wait shown is when the IP may ask again.
    SIGN_UP_LIMITS.perIpPerHour = 2;
    try {
      const ip = newViewer();
      const v = visitor(slug, ip);
      await v.signUp(form(emailFor('ipfull')));
      await visitor(slug, ip).signUp(form(emailFor('ipfull2')));
      const before = outbox.filter((m) => m.kind === 'sms').length;
      const verified = await v.post('/verify-email', { code: '000000' });
      expect(verified.body).toMatchObject({ step: 'VERIFY_PHONE' });
      expect(outbox.filter((m) => m.kind === 'sms').length).toBe(before);
      const wait =
        Date.parse((verified.body as { resendAvailableAt: string }).resendAvailableAt) - Date.now();
      expect(wait).toBeGreaterThan(50 * 60_000);
      expect(codeOf(await v.post('/resend', { channel: 'phone' }))).toBe('RATE_LIMITED');
    } finally {
      SIGN_UP_LIMITS.perIpPerHour = perIp;
    }
  });

  it('sends at most one "already registered" email for parallel sign-ups (#70 re-review)', async () => {
    const email = await registeredEmail();
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => visitor(slug, `100.66.${i + 1}.7`).signUp(form(email))),
    );
    expect(sentTo(email).filter((k) => k === 'registered').length).toBeLessThanOrEqual(1);
  });

  it('counts an address by its network, whatever its written form (#70 review)', async () => {
    const perNetwork = SIGN_UP_LIMITS.perNetworkPerHour;
    SIGN_UP_LIMITS.perNetworkPerHour = 2;
    try {
      for (const [first, second, third] of [
        // IPv4 written as an IPv4-mapped IPv6 address shares the IPv4 network.
        ['::ffff:198.51.100.7', '198.51.100.8', '198.51.100.9'],
        // IPv6 in short and long form, one /48.
        ['2001:db8:42::1', '2001:0db8:0042:0000:0000:0000:0000:0002', '2001:db8:42:ffff::3'],
      ]) {
        expect((await visitor(slug, first).signUp(form(emailFor('net6')))).status).toBe(200);
        expect((await visitor(slug, second).signUp(form(emailFor('net6')))).status).toBe(200);
        const over = await visitor(slug, third).signUp(form(emailFor('net6')));
        expect([third, over.status]).toEqual([third, 429]);
      }
    } finally {
      SIGN_UP_LIMITS.perNetworkPerHour = perNetwork;
    }
  });

  it("records the phone step's first SMS as a request, and counts every change (#70 review)", async () => {
    const v = visitor();
    await v.signUp(form(emailFor('smsreq')));
    const verified = await v.post('/verify-email', { code: '000000' });
    const wait =
      Date.parse((verified.body as { resendAvailableAt: string }).resendAvailableAt) - Date.now();
    expect(wait).toBeGreaterThan(40_000);
    expect(codeOf(await v.post('/resend', { channel: 'phone' }))).toBe('RATE_LIMITED');

    // Changes count toward the IP limit, inside the wait too, and send nothing there.
    const ip = newViewer();
    const changer = visitor(slug, ip);
    await changer.signUp(form(emailFor('changes')));
    const start = outbox.length;
    for (let i = 1; i < SIGN_UP_LIMITS.perIpPerHour; i += 1) {
      expect((await changer.post('/change-email', { email: emailFor('chg') })).status).toBe(200);
    }
    expect(outbox.length).toBe(start);
    const over = await changer.post('/change-email', { email: emailFor('chg') });
    expect([over.status, codeOf(over)]).toEqual([429, 'RATE_LIMITED']);
  });

  it('writes the legal acceptances only when the sign-up completes, from that attempt (#70 review)', async () => {
    const email = emailFor('accept');
    // Its own phone: the shared test number reaches its daily SMS cap in this file.
    const phone = `+1770555${String(1000 + Math.floor(Math.random() * 9000))}`;
    const abandoned = visitor(slug, newViewer());
    await abandoned.signUp(form(email, { phone }));
    const takerIp = newViewer();
    const taker = visitor(slug, takerIp);
    const acceptances = () =>
      asOwner({ kind: 'business', businessId: firmId }, (tx) =>
        tx.legalAcceptance.findMany({
          where: { clientAccount: { email } },
          select: { legalDocumentId: true, ip: true },
        }),
      );
    await withoutGap(async () => {
      await taker.signUp(form(email, { phone }));
      expect(await acceptances()).toEqual([]);
      await taker.post('/verify-email', { code: '000000' });
      expect(await acceptances()).toEqual([]);
      expect((await taker.post('/verify-phone', { code: '000000' })).body).toMatchObject({
        step: 'DONE',
      });
    });
    const written = await acceptances();
    expect(written.map((a) => a.legalDocumentId).sort()).toEqual([...docIds].sort());
    expect(written.map((a) => a.ip)).toEqual([takerIp, takerIp]);
  });

  it('answers a declined email exactly like a new one, through 5 wrong codes to CONTACT_FIRM (q13)', async () => {
    // A declined sign-up at this firm: its account stays declined, and its email gets nothing.
    const declinedEmail = emailFor('declined');
    const first = visitor();
    await first.signUp(form(declinedEmail));
    await withoutGap(async () => {
      await first.post('/verify-email', { code: '000000' });
      await first.post('/verify-phone', { code: '000000' });
    });
    await asOwner({ kind: 'business', businessId: firmId }, (tx) =>
      tx.clientAccount.updateMany({
        where: { email: declinedEmail },
        data: { status: 'DECLINED', declinedAt: new Date() },
      }),
    );
    const sentBefore = sentTo(declinedEmail).length;
    const newEmail = emailFor('newcomer');
    // Same length, so the cookies can be compared to the character.
    expect(newEmail.length).toBe(declinedEmail.length);

    const declined = visitor();
    const fresh = visitor();
    const pair = async (call: (v: ReturnType<typeof visitor>) => Promise<Response>) => {
      const [a, b] = [await call(declined), await call(fresh)];
      // The same answer apart from the email itself and the clock.
      const strip = (r: Response) => {
        const body = r.body as {
          email?: string;
          resendAvailableAt?: string | null;
          error?: Record<string, unknown>;
        };
        return {
          ...body,
          email: undefined,
          resendAvailableAt: body.resendAvailableAt === null,
          error: body.error ? { ...body.error, requestId: undefined } : undefined,
        };
      };
      const when = (r: Response) =>
        Date.parse((r.body as { resendAvailableAt?: string }).resendAvailableAt ?? '') || 0;
      expect(Math.abs(when(a) - when(b))).toBeLessThan(2_000);
      expect([a.status, strip(a), cookieValue(a)?.length]).toEqual([
        b.status,
        strip(b),
        cookieValue(b)?.length,
      ]);
      return [a, b] as const;
    };
    const phone = phoneFor();
    await pair((v) => v.signUp(form(v === declined ? declinedEmail : newEmail, { phone })));
    for (let i = 0; i < 5; i += 1) {
      const [a] = await pair((v) => v.post('/verify-email', { code: '111111' }));
      expect(codeOf(a)).toBe('CODE_INVALID');
    }
    const [atEnd] = await pair((v) => v.state());
    expect((atEnd.body as { step: string }).step).toBe('CONTACT_FIRM');
    for (const path of ['/verify-email', '/resend', '/change-email', '/change-phone'] as const) {
      const body =
        path === '/verify-email'
          ? { code: '000000' }
          : path === '/resend'
            ? { channel: 'email' }
            : path === '/change-email'
              ? { email: emailFor('other') }
              : { phone };
      const [a] = await pair((v) => v.post(path, body));
      expect([path, codeOf(a)]).toEqual([path, 'WRONG_STEP']);
    }
    // The declined person got nothing; a new sign-up still starts.
    expect(sentTo(declinedEmail).length).toBe(sentBefore);
    expect((await visitor().signUp(form(newEmail))).body).toMatchObject({ step: 'VERIFY_EMAIL' });
  });

  it("sends no SMS past the firm's daily cap, and answers the same", async () => {
    const cap = CODE_LIMITS.smsPerFirmPerDay;
    CODE_LIMITS.smsPerFirmPerDay = 0;
    try {
      const email = emailFor('smscap');
      const v = visitor();
      await v.signUp(form(email));
      const before = outbox.filter((m) => m.kind === 'sms').length;
      const res = await v.post('/verify-email', { code: '000000' });
      expect(res.body).toMatchObject({ step: 'VERIFY_PHONE' });
      expect(outbox.filter((m) => m.kind === 'sms').length).toBe(before);
    } finally {
      CODE_LIMITS.smsPerFirmPerDay = cap;
    }
  });

  it("needs this firm's own sign-up cookie", async () => {
    expect(codeOf(await visitor().state())).toBe('SIGN_UP_EXPIRED');
    const v = visitor();
    await v.signUp(form(emailFor('cookie')));
    const sealed = v.cookie.split('=').slice(1).join('=');
    const other = visitor(fx.firmA.slug);
    other.cookie = `${portalCookies(fx.firmA.slug).signUp}=${sealed}`;
    expect(codeOf(await other.state())).toBe('SIGN_UP_EXPIRED');
    v.cookie = `${portalCookies(slug).signUp}=${sealed.slice(0, -4)}AAAA`;
    expect(codeOf(await v.state())).toBe('SIGN_UP_EXPIRED');
  });
});
