import { expect, test } from '@playwright/test';
import {
  ApiRequestError,
  BEGIN_ONLINE_FORM_ORDER,
  INTAKE_FORMS,
  INTAKE_LIMITS,
  type IntakeAgreementBlock,
  type IntakeAnswers,
  intakeFields,
  type IntakeFormKey,
  intakeStepFields,
  type IntakeSignatureInput,
  type UploadTicket,
} from '@firmivra/types';
import { intakeBlockFixture } from '../../src/mocks/agreements';
import { createBeginOnlineMock, type MockBeginDraft } from '../../src/mocks/begin-online';
import { createMyIntakesMock, intakeFixtures, MOCK_KEY_DOWN_LAST4 } from '../../src/mocks/intake';

// The intake and Begin Online mocks themselves (no page): the upload limits hold when the screen
// sends several uploads at once, the 503 ENCRYPTION_UNAVAILABLE trigger saves nothing, a submit
// stores only the shown fields' answers, a submit's signature is checked against the agreement
// block as the API checks it, an upload ticket belongs to its draft, and Begin Online lists its
// forms in the page's order.

const SHA = 'a'.repeat(64);
const file = (slot: string, n: number) => ({
  slot,
  fileName: `Statement_${String(n)}.pdf`,
  contentType: 'application/pdf' as const,
  sizeBytes: 1000,
  sha256: SHA,
});
const maxFilesOf = (form: IntakeFormKey, slot: string) => {
  const field = intakeFields(INTAKE_FORMS[form]!).find((f) => f.key === slot);
  if (field?.type !== 'upload') throw new Error(`${slot} is not an upload field`);
  return field.maxFiles;
};
/** The answers of one step only, as a save of that step sends them. */
const stepAnswers = (form: IntakeFormKey, step: string, answers: IntakeAnswers) => {
  const s = INTAKE_FORMS[form]!.steps.find((x) => x.key === step)!;
  const keys = new Set(intakeStepFields(s).map((f) => f.key));
  return Object.fromEntries(Object.entries(answers).filter(([k]) => keys.has(k)));
};
/** The key of the step that holds a field. */
const stepOf = (form: IntakeFormKey, key: string) =>
  INTAKE_FORMS[form]!.steps.find((s) => intakeStepFields(s).some((f) => f.key === key))!.key;
/** The signature a review step sends for a block: every agreement, every box, the legal tick. */
const signFor = (block: IntakeAgreementBlock, name = 'Jamie Sample'): IntakeSignatureInput => ({
  agreements: block.agreements.map((a) => ({
    agreementId: a.agreementId,
    version: a.version,
    bodySha256: a.bodySha256,
  })),
  acknowledgments: block.agreements.flatMap((a) =>
    a.acknowledgments.map((k) => ({ agreementId: a.agreementId, key: k.key })),
  ),
  acceptLegal: block.legal
    ? { termsVersion: block.legal.terms.version, privacyVersion: block.legal.privacy.version }
    : null,
  signer: { printedName: name, method: 'TYPED', typedSignature: name },
});
const codeOf = (r: PromiseSettledResult<unknown>) =>
  r.status === 'rejected' && r.reason instanceof ApiRequestError ? r.reason.code : r.status;

test.describe('intake mock uploads', () => {
  test('files confirmed at once never pass the slot limit', async () => {
    const api = createMyIntakesMock();
    const row = intakeFixtures()[0]!;
    const slot = 'incomeDocuments';
    const room =
      maxFilesOf(row.item.form, slot) - row.files.filter((f) => f.upload.slot === slot).length;
    const extra = 3;
    // Every ticket is issued (step 1 counts stored files only, as the API does)...
    const tickets = await Promise.all(
      Array.from({ length: room + extra }, (_, n) => api.createUpload(row.item.id, file(slot, n))),
    );
    // ...and of the confirms sent together only those that fit are kept.
    const confirmed = await Promise.allSettled(
      tickets.map((t: UploadTicket) =>
        api.confirmUpload(row.item.id, { uploadToken: t.uploadToken }),
      ),
    );
    expect(confirmed.filter((r) => r.status === 'fulfilled')).toHaveLength(room);
    expect(confirmed.map(codeOf).filter((c) => c === 'TOO_MANY_FILES')).toHaveLength(extra);
    const after = await api.get(row.item.id);
    expect(after.uploads.filter((u) => u.slot === slot)).toHaveLength(room);
    // Full now: a new ticket is refused at step 1.
    await expect(api.createUpload(row.item.id, file(slot, 99))).rejects.toMatchObject({
      code: 'TOO_MANY_FILES',
    });
  });

  test('files confirmed at once across slots never pass the form-wide limit', async () => {
    const api = createMyIntakesMock();
    const row = intakeFixtures()[0]!;
    // Every upload slot of the form, each ticketed up to its own maxFiles: together more than the
    // form-wide limit, so only the per-form check can stop them.
    const slots = intakeFields(INTAKE_FORMS[row.item.form]!).flatMap((f) =>
      f.type === 'upload'
        ? Array.from(
            { length: f.maxFiles - row.files.filter((x) => x.upload.slot === f.key).length },
            () => f.key,
          )
        : [],
    );
    const room = INTAKE_LIMITS.maxFiles - row.files.length;
    expect(slots.length).toBeGreaterThan(room);
    const tickets = await Promise.all(
      slots.map((slot, n) => api.createUpload(row.item.id, file(slot, n))),
    );
    const confirmed = await Promise.allSettled(
      tickets.map((t) => api.confirmUpload(row.item.id, { uploadToken: t.uploadToken })),
    );
    expect(confirmed.filter((r) => r.status === 'fulfilled')).toHaveLength(room);
    expect(confirmed.map(codeOf).filter((c) => c === 'TOO_MANY_FILES')).toHaveLength(
      slots.length - room,
    );
    expect((await api.get(row.item.id)).uploads).toHaveLength(INTAKE_LIMITS.maxFiles);
  });

  test('a new SSN ending in the trigger digits answers 503 and saves nothing', async () => {
    const api = createMyIntakesMock();
    const row = intakeFixtures()[0]!;
    const before = await api.get(row.item.id);
    const personal = stepAnswers(row.item.form, 'personal', before.answers);
    await expect(
      api.saveStep(row.item.id, 'personal', {
        answers: { ...personal, ssn: `900-12-${MOCK_KEY_DOWN_LAST4}` },
      }),
    ).rejects.toMatchObject({ status: 503, code: 'ENCRYPTION_UNAVAILABLE' });
    expect((await api.get(row.item.id)).answers['ssn']).toEqual(before.answers['ssn']);
    // The stored number sent back as { last4 } saves as usual.
    await api.saveStep(row.item.id, 'personal', { answers: personal });
  });
});

test.describe('Begin Online mock uploads', () => {
  test('files confirmed at once never pass the slot limit', async () => {
    const api = createBeginOnlineMock('lvp');
    await api.start('ANNUAL_TAX', {
      firstName: 'Avery',
      lastName: 'Example',
      email: 'avery.example@lvp.test',
    });
    const slot = 'governmentId';
    const room = maxFilesOf('ANNUAL_TAX', slot);
    const extra = 2;
    const tickets = await Promise.all(
      Array.from({ length: room + extra }, (_, n) => api.createUpload('ANNUAL_TAX', file(slot, n))),
    );
    const confirmed = await Promise.allSettled(
      tickets.map((t) => api.confirmUpload('ANNUAL_TAX', { uploadToken: t.uploadToken })),
    );
    expect(confirmed.filter((r) => r.status === 'fulfilled')).toHaveLength(room);
    expect(confirmed.map(codeOf).filter((c) => c === 'TOO_MANY_FILES')).toHaveLength(extra);
    expect((await api.uploads('ANNUAL_TAX')).filter((u) => u.slot === slot)).toHaveLength(room);
  });

  test("a ticket belongs to its draft: a new draft can't confirm an older one's", async () => {
    const api = createBeginOnlineMock('lvp');
    const avery = { firstName: 'Avery', lastName: 'Example', email: 'avery.example@lvp.test' };
    await api.start('ANNUAL_TAX', avery);
    const old = await api.createUpload('ANNUAL_TAX', file('governmentId', 1));
    // Starting again replaces this browser's draft: the old draft's ticket has expired.
    await api.start('ANNUAL_TAX', { ...avery, firstName: 'Jordan' });
    await expect(
      api.confirmUpload('ANNUAL_TAX', { uploadToken: old.uploadToken }),
    ).rejects.toMatchObject({ status: 410, code: 'UPLOAD_EXPIRED' });
    expect(await api.uploads('ANNUAL_TAX')).toEqual([]);
    // A ticket of the current draft still confirms.
    const fresh = await api.createUpload('ANNUAL_TAX', file('governmentId', 2));
    await api.confirmUpload('ANNUAL_TAX', { uploadToken: fresh.uploadToken });
    expect(await api.uploads('ANNUAL_TAX')).toHaveLength(1);
  });

  test('a new SSN ending in the trigger digits answers 503 and saves nothing', async () => {
    const api = createBeginOnlineMock('lvp');
    const draft = await api.start('ANNUAL_TAX', {
      firstName: 'Avery',
      lastName: 'Example',
      email: 'avery.example@lvp.test',
    });
    await expect(
      api.saveStep('ANNUAL_TAX', 'personal', {
        answers: {
          ...stepAnswers('ANNUAL_TAX', 'personal', draft.answers),
          ssn: `900-12-${MOCK_KEY_DOWN_LAST4}`,
        },
      }),
    ).rejects.toMatchObject({ status: 503, code: 'ENCRYPTION_UNAVAILABLE' });
    expect((await api.get('ANNUAL_TAX')).answers['ssn']).toBeUndefined();
  });
});

test.describe('a submit stores the cleaned answers', () => {
  test("intake: a hidden question's answer is not in the locked version", async () => {
    const api = createMyIntakesMock();
    const row = intakeFixtures().find((r) => r.item.form === 'BOOKKEEPING')!;
    const before = await api.get(row.item.id);
    expect(before.answers['catchUpFrom']).toBe('2026-01');
    // "No catch-up needed" hides "from what date"; a save keeps the hidden answer...
    const step = stepOf('BOOKKEEPING', 'needsCatchUp');
    await api.saveStep(row.item.id, step, {
      answers: { ...stepAnswers('BOOKKEEPING', step, before.answers), needsCatchUp: false },
    });
    expect((await api.get(row.item.id)).answers['catchUpFrom']).toBe('2026-01');
    // ...the submit drops it, as the API's locked version holds only shown fields' answers.
    const block = intakeBlockFixture('lvp', 'BOOKKEEPING', 'portal');
    const submitted = await api.submit(row.item.id, { signature: signFor(block) });
    expect(submitted.status).toBe('SUBMITTED');
    expect(submitted.answers).not.toHaveProperty('catchUpFrom');
    expect((await api.get(row.item.id)).answers).not.toHaveProperty('catchUpFrom');
    expect(submitted.answers['needsCatchUp']).toBe(false);
  });

  test("Begin Online: a hidden question's answer is not in the submitted lead", async () => {
    const drafts = new Map<IntakeFormKey, MockBeginDraft>();
    const api = createBeginOnlineMock('lvp', drafts);
    const form = 'TAX_PLANNING';
    const complete = intakeFixtures().find((r) => r.item.form === form)!.answers;
    await api.start(form, {
      firstName: 'Jamie',
      lastName: 'Sample',
      email: 'jamie.sample@lvp.test',
    });
    // "Multiple states?" is No, so "list the state(s)" is hidden; the save keeps its answer.
    const answers = { ...complete, multipleStates: false, incomeStates: ['GA'] };
    for (const step of INTAKE_FORMS[form]!.steps) {
      await api.saveStep(form, step.key, { answers: stepAnswers(form, step.key, answers) });
    }
    expect(drafts.get(form)!.answers['incomeStates']).toEqual(['GA']);
    await api.submit(form, {
      signature: signFor(intakeBlockFixture('lvp', form, 'begin'), 'Jamie Sample'),
    });
    const stored = drafts.get(form)!;
    expect(stored.submitted).toBe(true);
    expect(stored.answers).not.toHaveProperty('incomeStates');
    expect(stored.answers['w2Income']).toBe(complete['w2Income']);
  });
});

test.describe('Begin Online mock forms', () => {
  test("lists the services in the page's order, only the forms INTAKE_FORMS has", async () => {
    const api = createBeginOnlineMock('lvp');
    const listed = (await api.forms()).map((f) => f.form);
    expect(listed).toEqual(BEGIN_ONLINE_FORM_ORDER.filter((form) => INTAKE_FORMS[form]));
    expect(listed).toEqual([
      'ANNUAL_TAX',
      'BOOKKEEPING',
      'PAYROLL',
      'BUSINESS_DEVELOPMENT',
      'QUARTERLY_TAX',
      'TAX_PLANNING',
    ]);
  });
});

test.describe('a submit checks the signature against the agreement block', () => {
  const bookkeeping = () => intakeFixtures().find((r) => r.item.form === 'BOOKKEEPING')!;
  const portalBlock = () => intakeBlockFixture('lvp', 'BOOKKEEPING', 'portal');

  test('intake: a missing signature is 400 and nothing is submitted', async () => {
    const api = createMyIntakesMock();
    const row = bookkeeping();
    await expect(api.submit(row.item.id, {} as never)).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
    expect((await api.get(row.item.id)).status).toBe('NEEDS_CORRECTION');
  });

  test('intake: each invalid signature answers its code, the full one submits', async () => {
    const api = createMyIntakesMock();
    const row = bookkeeping();
    const block = portalBlock();
    const good = signFor(block);
    const [firmWide, service] = good.agreements;
    const nbsp = 'Jamie\u00a0Sample';
    const cases: [IntakeSignatureInput, number, string][] = [
      // The Bookkeeping service's own agreement left out.
      [{ ...good, agreements: [firmWide!], acknowledgments: [] }, 409, 'AGREEMENT_OUTDATED'],
      [
        // The firm-wide agreement's previous version (the block has version 2).
        { ...good, agreements: [{ ...firmWide!, version: firmWide!.version - 1 }, service!] },
        409,
        'AGREEMENT_OUTDATED',
      ],
      [
        { ...good, agreements: [firmWide!, { ...service!, bodySha256: 'f'.repeat(64) }] },
        409,
        'AGREEMENT_OUTDATED',
      ],
      [{ ...good, acknowledgments: [] }, 400, 'ACKNOWLEDGMENT_REQUIRED'],
      [
        { ...good, acknowledgments: [{ agreementId: firmWide!.agreementId, key: 'not_a_box' }] },
        400,
        'VALIDATION_FAILED',
      ],
      // The portal never accepts Terms and Privacy (a client did at sign-up).
      [{ ...good, acceptLegal: { termsVersion: 2, privacyVersion: 1 } }, 400, 'VALIDATION_FAILED'],
      // The schema's key collapses U+00A0; the database's doesn't.
      [
        { ...good, signer: { printedName: nbsp, method: 'TYPED', typedSignature: 'Jamie Sample' } },
        400,
        'SIGNATURE_MISMATCH',
      ],
      [
        {
          ...good,
          signer: { printedName: 'Jamie Sample', method: 'TYPED', typedSignature: 'Avery' },
        },
        400,
        'VALIDATION_FAILED',
      ],
    ];
    for (const [signature, status, code] of cases) {
      await expect(api.submit(row.item.id, { signature })).rejects.toMatchObject({ status, code });
    }
    expect((await api.get(row.item.id)).status).toBe('NEEDS_CORRECTION');
    // Only the required boxes ticked is enough.
    const required = {
      ...good,
      acknowledgments: block.agreements.flatMap((a) =>
        a.acknowledgments
          .filter((k) => k.required)
          .map((k) => ({ agreementId: a.agreementId, key: k.key })),
      ),
    };
    const submitted = await api.submit(row.item.id, { signature: required });
    expect(submitted.status).toBe('SUBMITTED');
    expect(submitted.signature?.printedName).toBe('Jamie Sample');
  });

  test('Begin Online: Terms and Privacy are required, at the versions shown', async () => {
    const api = createBeginOnlineMock('lvp');
    const form = 'TAX_PLANNING';
    const complete = intakeFixtures().find((r) => r.item.form === form)!.answers;
    await api.start(form, {
      firstName: 'Jamie',
      lastName: 'Sample',
      email: 'jamie.sample@lvp.test',
    });
    for (const step of INTAKE_FORMS[form]!.steps) {
      await api.saveStep(form, step.key, { answers: stepAnswers(form, step.key, complete) });
    }
    const block = intakeBlockFixture('lvp', form, 'begin');
    expect(block.legal).not.toBeNull();
    const good = signFor(block);
    await expect(api.submit(form, {} as never)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(
      api.submit(form, { signature: { ...good, acceptLegal: null } }),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    await expect(
      api.submit(form, {
        signature: { ...good, acceptLegal: { termsVersion: 1, privacyVersion: 1 } },
      }),
    ).rejects.toMatchObject({ status: 409, code: 'TERMS_OUTDATED' });
    await expect(
      api.submit(form, { signature: { ...good, agreements: [] } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const done = await api.submit(form, { signature: good });
    expect(done).toMatchObject({ received: true, form });
  });

  test('Begin Online: "noagreement" in an answer is 409 NO_INTAKE_AGREEMENT', async () => {
    const api = createBeginOnlineMock('lvp');
    const form = 'TAX_PLANNING';
    const complete = intakeFixtures().find((r) => r.item.form === form)!.answers;
    await api.start(form, {
      firstName: 'Jamie',
      lastName: 'Sample',
      email: 'noagreement@lvp.test',
    });
    for (const step of INTAKE_FORMS[form]!.steps) {
      await api.saveStep(form, step.key, {
        answers: stepAnswers(form, step.key, { ...complete, email: 'noagreement@lvp.test' }),
      });
    }
    await expect(
      api.submit(form, { signature: signFor(intakeBlockFixture('lvp', form, 'begin')) }),
    ).rejects.toMatchObject({ status: 409, code: 'NO_INTAKE_AGREEMENT' });
  });
});
