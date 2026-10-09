import { expect, test } from '@playwright/test';
import {
  ApiRequestError,
  BEGIN_ONLINE_FORM_ORDER,
  INTAKE_FORMS,
  type IntakeAnswers,
  intakeFields,
  type IntakeFormKey,
  intakeStepFields,
  type UploadTicket,
} from '@firmivra/types';
import { createBeginOnlineMock, type MockBeginDraft } from '../../src/mocks/begin-online';
import { createMyIntakesMock, intakeFixtures, MOCK_KEY_DOWN_LAST4 } from '../../src/mocks/intake';

// The intake and Begin Online mocks themselves (no page): the upload limits hold when the screen
// sends several uploads at once, the 503 ENCRYPTION_UNAVAILABLE trigger saves nothing, a submit
// stores only the shown fields' answers, and Begin Online lists its forms in the page's order.

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
    const submitted = await api.submit(row.item.id, {});
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
    await api.submit(form, {});
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
