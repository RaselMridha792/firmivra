import { describe, expect, it } from 'vitest';
import {
  ANNUAL_TAX_FORM,
  checkIntakeAnswers,
  hiddenSlotUploads,
  IntakeAnswers,
  IntakeAnswersInput,
  IntakeFormDefinition,
  intakeNumbersMasked,
  intakeUploadCounts,
  maskIntakeAnswers,
  restoreMaskedNumbers,
  shownIntakeKeys,
} from '../../src/index.js';

const annual = ANNUAL_TAX_FORM;
const today = '2026-10-08';
const save = (step: string, answers: Record<string, unknown>) =>
  checkIntakeAnswers(annual, answers, { mode: 'save', step, today });
const messages = (result: { issues: { path: unknown[]; message: string }[] }) =>
  result.issues.map((i) => [i.path.join('.'), i.message]);
/** Characters written by code, so the source stays plain ASCII. */
const NUL = String.fromCharCode(0);
const RLO = String.fromCharCode(0x202e);
const ZWSP = String.fromCharCode(0x200b);

/** A complete Annual Tax for a single filer with a personal return and no dependents. */
const complete = {
  firstName: 'Avery',
  lastName: 'Example',
  dateOfBirth: '1985-04-12',
  phone: '(404) 555-0123',
  email: 'Avery.Example@LVP.test',
  ssn: '900-12-3456',
  street: '100 Example Way',
  city: 'Atlanta',
  state: 'GA',
  zip: '30301',
  filingStatus: 'SINGLE',
  claimedAsDependent: false,
  returnTypes: ['PERSONAL'],
  legalStatus: 'US_CITIZEN',
  armedForces: false,
  hasDependents: false,
  socialSecurityCard: { notAvailable: true, reason: 'Ordered a replacement card.' },
  certifyDocuments: true,
  paymentPreference: 'PAY_AFTER',
};
const submit = (answers: Record<string, unknown>, uploads: Record<string, number> = {}) =>
  checkIntakeAnswers(annual, answers, { mode: 'submit', uploads, today });
/** A business return with one business, for the group and business-step tests. */
const withBusiness = (business: Record<string, unknown>) => ({
  ...complete,
  returnTypes: ['BUSINESS'],
  businesses: [{ id: 'b1', sells: 'SERVICES', productsOrServices: 'Bookkeeping', ...business }],
  businessDocuments: { notAvailable: true, reason: 'Sending them next week.' },
});

describe('checkIntakeAnswers: save (autosave of one step)', () => {
  it('cleans the values up and requires nothing', () => {
    const result = save('personal', {
      firstName: '  Avery ',
      email: 'Avery@LVP.test',
      phone: '404.555.0123',
      ssn: '900-12-3456',
      middleName: '',
      returnTypes: ['PERSONAL', 'PERSONAL'],
      comments: null,
    });
    expect(result.issues).toEqual([]);
    expect(result.answers).toEqual({
      firstName: 'Avery',
      email: 'avery@lvp.test',
      phone: '+14045550123',
      ssn: '900123456',
      returnTypes: ['PERSONAL'],
    });
  });

  it('passes an SSN sent back as { last4 }, also in a group row', () => {
    const row = { id: 'row-1', firstName: 'Jordan', ssn: { last4: '4321' } };
    const result = save('personal', { ssn: { last4: '3456' }, dependents: [row] });
    expect(result.issues).toEqual([]);
    expect(result.answers).toEqual({ ssn: { last4: '3456' }, dependents: [row] });
  });

  it('refuses unknown keys, keys of another step, wrong types and unknown options', () => {
    const result = save('personal', {
      nickname: 'Ave',
      paymentPreference: 'PAY_AFTER',
      dateOfBirth: '2099-01-01',
      filingStatus: 'MARRIED',
      zip: '3030',
      armedForces: 'no',
      ssn: '12345',
    });
    expect(messages(result)).toEqual([
      ['nickname', 'Not a question here'],
      ['paymentPreference', 'Not a question here'],
      ['dateOfBirth', 'The date cannot be in the future'],
      ['ssn', 'Enter the 9-digit SSN'],
      ['zip', 'Enter a valid ZIP code'],
      ['filingStatus', 'Choose one of the options'],
      ['armedForces', 'Answer yes or no'],
    ]);
  });

  it('refuses hidden and direction-changing characters, and text over its limit', () => {
    const result = save('personal', {
      firstName: `Evil${RLO}gnp`,
      comments: `Zero${ZWSP}width`,
      lastName: 'x'.repeat(101),
    });
    expect(result.issues.map((i) => i.path[0])).toEqual(['firstName', 'lastName', 'comments']);
    expect(result.answers).toEqual({});
  });

  it('keeps dates between 1900 and 2100', () => {
    for (const date of ['1899-12-31', '2101-01-01', '2999-01-01']) {
      expect(messages(save('personal', { dateOfBirth: date }))).toEqual([
        ['dateOfBirth', 'Enter a date between 1900 and 2100'],
      ]);
    }
    expect(save('personal', { dateOfBirth: '1900-01-01' }).issues).toEqual([]);
  });

  it('checks group rows and grid cells, and answers an unknown step', () => {
    const rows = save('personal', {
      dependents: [
        { firstName: 'No id' },
        { id: 'a', relationship: 'COUSIN' },
        { id: 'b' },
        { id: 'b' },
      ],
    });
    expect(messages(rows)).toEqual([
      ['dependents.0', 'Each row needs its own id'],
      ['dependents.1.relationship', 'Choose one of the options'],
      ['dependents.3', 'Each row needs its own id'],
    ]);
    const grid = save('businessIncome', {
      businessIncome: { salesOfProducts: { q1: 150_000, q2: -5, nope: 1 }, unknownRow: {} },
    });
    expect(messages(grid)).toEqual([
      ['businessIncome.salesOfProducts.q2', 'Enter a positive amount'],
      ['businessIncome.salesOfProducts.nope', 'Not a column of this table'],
      ['businessIncome.unknownRow', 'Not a row of this table'],
    ]);
    expect(grid.answers).toEqual({ businessIncome: { salesOfProducts: { q1: 150_000 } } });
    expect(save('nowhere', {}).issues[0]?.message).toBe('Not a step of this form');
  });

  it('takes "I have it after all" without a reason, and a reason of at most 1,000 characters', () => {
    const ok = save('documents', {
      governmentId: { notAvailable: false },
      socialSecurityCard: { notAvailable: true, reason: 'x'.repeat(1000) },
    });
    expect(ok.issues).toEqual([]);
    expect(ok.answers).toEqual({
      socialSecurityCard: { notAvailable: true, reason: 'x'.repeat(1000) },
    });
    const long = save('documents', {
      socialSecurityCard: { notAvailable: true, reason: 'x'.repeat(1001) },
    });
    expect(messages(long)).toEqual([['socialSecurityCard', 'Use at most 1000 characters']]);
  });
});

describe('checkIntakeAnswers: url and month answers', () => {
  const definition = {
    ...annual,
    steps: [
      {
        key: 'one',
        title: 'One',
        review: false,
        sections: [
          {
            key: 'one',
            title: 'One',
            fields: [
              { key: 'website', type: 'url' as const, label: 'Website', required: false },
              { key: 'startMonth', type: 'month' as const, label: 'Start', required: false },
            ],
          },
        ],
      },
    ],
  };
  const check = (answers: Record<string, unknown>) =>
    checkIntakeAnswers(definition, answers, { mode: 'save', step: 'one' });

  it('reads example.com as https and stores the normalised address', () => {
    expect(check({ website: ' Example.COM/Path ' }).answers).toEqual({
      website: 'https://example.com/Path',
    });
  });

  it('refuses control and direction characters, and a user name or password', () => {
    for (const bad of [
      `example.com/${NUL}`,
      `example${RLO}.com`,
      'https://user:secret@example.com',
      'https://user@example.com',
      'ftp://example.com',
    ]) {
      expect([bad, check({ website: bad }).issues.length]).toEqual([bad, 1]);
    }
  });

  it('keeps months between 1900 and 2100', () => {
    expect(check({ startMonth: '2026-08' }).issues).toEqual([]);
    for (const bad of ['1899-12', '2101-01', '2026-13']) {
      expect([bad, check({ startMonth: bad }).issues.length]).toEqual([bad, 1]);
    }
  });
});

describe('checkIntakeAnswers: submit', () => {
  it('passes a complete form, with a file for a required slot', () => {
    const result = submit(complete, { governmentId: 1 });
    expect(result.issues).toEqual([]);
    expect(result.answers['email']).toBe('avery.example@lvp.test');
  });

  it('names every missing required answer, on its step', () => {
    const result = submit({ firstName: 'Avery' });
    const missing = result.issues.map((i) => `${i.step}:${String(i.path[0])}`);
    expect(missing).toEqual(
      expect.arrayContaining([
        'personal:lastName',
        'personal:ssn',
        'personal:filingStatus',
        'documents:governmentId',
        'documents:certifyDocuments',
        'review:paymentPreference',
      ]),
    );
    // Hidden ones are not asked for: no spouse, no business step, no dependents' documents.
    expect(missing.some((m) => m.includes(':spouse'))).toBe(false);
    expect(missing.some((m) => m.startsWith('businessIncome:'))).toBe(false);
    expect(missing).not.toContain('documents:dependentDocuments');
  });

  it('drops the answers of hidden fields and steps', () => {
    const result = submit(
      {
        ...complete,
        spouseFirstName: 'Sam',
        spouseSsn: '900-99-9999',
        businessIncome: { salesOfProducts: { q1: 100 } },
      },
      { governmentId: 1 },
    );
    expect(result.issues).toEqual([]);
    expect(result.answers).not.toHaveProperty('spouseSsn');
    expect(result.answers).not.toHaveProperty('businessIncome');
    const shown = shownIntakeKeys(annual, { ...complete, filingStatus: 'MARRIED_FILING_JOINTLY' });
    expect(shown.fields.has('spouseSsn')).toBe(true);
    expect(shown.steps.has('businessIncome')).toBe(false);
  });

  it("drops a group sub-field its row's answers hide", () => {
    const hidden = submit(withBusiness({ legalStructure: 'LLC', legalStructureOther: 'Co-op' }), {
      governmentId: 1,
    });
    expect(hidden.issues).toEqual([]);
    expect(hidden.answers['businesses']).toEqual([
      { id: 'b1', legalStructure: 'LLC', sells: 'SERVICES', productsOrServices: 'Bookkeeping' },
    ]);
    const shown = submit(withBusiness({ legalStructure: 'OTHER', legalStructureOther: 'Co-op' }), {
      governmentId: 1,
    });
    expect(shown.answers['businesses']).toEqual([
      expect.objectContaining({ legalStructureOther: 'Co-op' }),
    ]);
  });

  it('checks rows, ticks and uploads: each needs what it asks for', () => {
    const result = submit(
      {
        ...complete,
        hasDependents: true,
        dependents: [{ id: 'd1', firstName: 'Jordan', lastName: 'Example' }],
        certifyDocuments: false,
        socialSecurityCard: { notAvailable: true, reason: '' },
      },
      { governmentId: 0 },
    );
    expect(messages(result)).toEqual([
      ['dependents.0.dateOfBirth', 'This is required'],
      ['dependents.0.relationship', 'This is required'],
      ['governmentId', "Upload a file or tell us why you don't have it"],
      ['socialSecurityCard', "Tell us why you don't have this document"],
      ['dependentDocuments', "Upload a file or tell us why you don't have it"],
      ['certifyDocuments', 'Tick this box to continue'],
    ]);
  });
});

describe('group rows on submit', () => {
  /** A form with one group whose rows hold a required tick box and a required choice of two. */
  const rows = IntakeFormDefinition.parse({
    key: 'PAYROLL',
    version: 1,
    title: 'Rows',
    steps: [
      {
        key: 'people',
        title: 'People',
        review: false,
        sections: [
          {
            key: 'people',
            title: 'People',
            fields: [
              {
                key: 'people',
                type: 'group',
                label: 'People',
                required: false,
                minItems: 0,
                maxItems: 5,
                itemLabel: 'Person',
                addLabel: 'Add Another Person',
                fields: [
                  { key: 'consent', type: 'checkbox', label: 'Consent', required: true },
                  {
                    key: 'roles',
                    type: 'checkboxes',
                    label: 'Roles',
                    required: true,
                    minItems: 2,
                    options: [
                      { value: 'A', label: 'A' },
                      { value: 'B', label: 'B' },
                      { value: 'C', label: 'C' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        key: 'review',
        title: 'Review',
        review: true,
        sections: [
          {
            key: 'note',
            title: 'Note',
            fields: [{ key: 'note', type: 'info', label: 'Note', text: 'Thanks', required: false }],
          },
        ],
      },
    ],
  });
  const check = (people: unknown[]) =>
    messages(checkIntakeAnswers(rows, { people }, { mode: 'submit', today }));

  it('needs a required tick box ticked and at least minItems choices in each row', () => {
    expect(check([{ id: 'p1', consent: false, roles: ['A'] }])).toEqual([
      ['people.0.consent', 'Tick this box to continue'],
      ['people.0.roles', 'Choose at least 2'],
    ]);
    expect(check([{ id: 'p1' }])).toEqual([
      ['people.0.consent', 'Tick this box to continue'],
      ['people.0.roles', 'Choose at least one'],
    ]);
    expect(check([{ id: 'p1', consent: true, roles: ['A', 'B'] }])).toEqual([]);
  });

  it('asks nothing of a row on save', () => {
    const saved = checkIntakeAnswers(
      rows,
      { people: [{ id: 'p1', consent: false, roles: ['A'] }] },
      { mode: 'save', step: 'people', today },
    );
    expect(saved.issues).toEqual([]);
  });
});

describe('married filers', () => {
  it("must give the spouse's first and last name, SSN and date of birth", () => {
    const married = submit(
      { ...complete, filingStatus: 'MARRIED_FILING_JOINTLY' },
      { governmentId: 1 },
    );
    expect(married.issues.map((i) => String(i.path[0]))).toEqual(
      expect.arrayContaining([
        'spouseFirstName',
        'spouseLastName',
        'spouseSsn',
        'spouseDateOfBirth',
      ]),
    );
  });
});

describe('uploads on submit', () => {
  const upload = (slot: string, status: 'CLEAN' | 'PENDING' | 'INFECTED' | 'FAILED') => ({
    slot,
    status,
  });

  it('counts only clean files and files still being scanned toward a required slot', () => {
    expect(
      intakeUploadCounts([
        upload('governmentId', 'CLEAN'),
        upload('governmentId', 'PENDING'),
        upload('socialSecurityCard', 'INFECTED'),
        upload('socialSecurityCard', 'FAILED'),
      ]),
    ).toEqual({ governmentId: 2 });
    // An infected or unreadable file never answers a required slot on submit.
    const onlyBad = intakeUploadCounts([
      upload('governmentId', 'INFECTED'),
      upload('governmentId', 'FAILED'),
    ]);
    expect(onlyBad).toEqual({});
    const result = submit(complete, onlyBad);
    expect(result.issues.map((i) => i.path[0])).toContain('governmentId');
  });

  it('takes out the files of slots the answers hide', () => {
    const files = [
      upload('governmentId', 'CLEAN'),
      upload('spouseGovernmentId', 'CLEAN'),
      upload('businessDocuments', 'PENDING'),
      upload('gone', 'CLEAN'),
    ];
    expect(hiddenSlotUploads(annual, complete, files).map((f) => f.slot)).toEqual([
      'spouseGovernmentId',
      'businessDocuments',
      'gone',
    ]);
    const married = { ...complete, filingStatus: 'MARRIED_FILING_JOINTLY' };
    expect(hiddenSlotUploads(annual, married, files).map((f) => f.slot)).toEqual([
      'businessDocuments',
      'gone',
    ]);
  });

  it('takes out a file whose slot is a shown field that is not an upload field', () => {
    const files = [upload('governmentId', 'CLEAN'), upload('firstName', 'CLEAN')];
    expect(hiddenSlotUploads(annual, complete, files).map((f) => f.slot)).toEqual(['firstName']);
  });
});

describe('SSNs and EINs', () => {
  const stored = {
    ssn: '900123456',
    dependents: [{ id: 'd1', firstName: 'Riley', ssn: '900654321' }],
  };

  it('masks every number, at the top level and in group rows', () => {
    const masked = maskIntakeAnswers(annual, { ...stored, firstName: 'Avery' });
    expect(masked).toEqual({
      firstName: 'Avery',
      ssn: { last4: '3456' },
      dependents: [{ id: 'd1', firstName: 'Riley', ssn: { last4: '4321' } }],
    });
    expect(intakeNumbersMasked(annual, masked)).toBe(true);
    expect(intakeNumbersMasked(annual, stored)).toBe(false);
    expect(intakeNumbersMasked(annual, { ...masked, dependents: stored.dependents })).toBe(false);
  });

  it('refuses answers where a number could hide: an unknown key, a group not of its rows', () => {
    const ok = { firstName: 'Avery', dependents: [{ id: 'd1', ssn: { last4: '4321' } }] };
    expect(intakeNumbersMasked(annual, ok)).toBe(true);
    expect(intakeNumbersMasked(annual, { ...ok, dependents: null })).toBe(true);
    expect(intakeNumbersMasked(annual, { ...ok, dependents: [] })).toBe(true);
    for (const leak of [
      { oldSsn: '123-45-6789' },
      { dependents: '123-45-6789' },
      { dependents: ['123456789'] },
      { dependents: { r1: { ssn: '123456789' } } },
      { dependents: [{ id: 'r1', taxId: '123456789' }] },
    ]) {
      expect([leak, intakeNumbersMasked(annual, { ...ok, ...leak })]).toEqual([leak, false]);
    }
  });

  it('puts back the stored number for a matching { last4 }, by key and by row id', () => {
    const result = restoreMaskedNumbers(
      annual,
      { ssn: { last4: '3456' }, dependents: [{ id: 'd1', ssn: { last4: '4321' } }] },
      stored,
    );
    expect(result.issues).toEqual([]);
    expect(result.answers).toEqual({
      ssn: '900123456',
      dependents: [{ id: 'd1', ssn: '900654321' }],
    });
  });

  it('refuses a { last4 } with nothing stored, another number, or another row', () => {
    const none = restoreMaskedNumbers(annual, { ssn: { last4: '3456' } }, {});
    const other = restoreMaskedNumbers(annual, { ssn: { last4: '0000' } }, stored);
    const row = restoreMaskedNumbers(
      annual,
      { dependents: [{ id: 'd2', ssn: { last4: '4321' } }] },
      stored,
    );
    expect(
      [none, other, row].map((r) => r.issues.map((i) => [i.step, i.path.join('.'), i.message])),
    ).toEqual([
      [['personal', 'ssn', 'Enter the full number again']],
      [['personal', 'ssn', 'Enter the full number again']],
      [['personal', 'dependents.0.ssn', 'Enter the full number again']],
    ]);
  });
});

describe('answer transport', () => {
  const keys = (count: number, value: unknown = 1) =>
    Object.fromEntries(Array.from({ length: count }, (_, i) => [`k${String(i)}`, value]));
  const ok = (value: unknown) => IntakeAnswersInput.safeParse(value).success;

  it('requests refuse extra keys in a masked number or an upload answer; responses drop them', () => {
    expect(ok({ ssn: { last4: '1234', full: 'x' } })).toBe(false);
    expect(IntakeAnswers.parse({ ssn: { last4: '1234' } })).toEqual({ ssn: { last4: '1234' } });
    expect(ok({ 'bad key': 1 })).toBe(false);
    expect(ok({ dependents: [{ id: 'a', firstName: 'Jordan' }] })).toBe(true);
    expect(ok({ doc: { notAvailable: false } })).toBe(true);
  });

  it('bounds the map: 500 answers, 31 keys a row, 50 by 10 a grid', () => {
    expect(ok(keys(500))).toBe(true);
    expect(ok(keys(501))).toBe(false);
    expect(ok({ rows: [{ id: 'a', ...keys(30, 'x') }] })).toBe(true);
    expect(ok({ rows: [{ id: 'a', ...keys(31, 'x') }] })).toBe(false);
    expect(ok({ grid: keys(50, { q1: 1 }) })).toBe(true);
    expect(ok({ grid: keys(51, { q1: 1 }) })).toBe(false);
    expect(ok({ grid: { row: keys(10) } })).toBe(true);
    expect(ok({ grid: { row: keys(11) } })).toBe(false);
  });

  it('refuses __proto__, constructor and prototype as keys, at every level', () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      expect([key, ok(JSON.parse(`{"${key}": 1}`))]).toEqual([key, false]);
      expect([key, ok(JSON.parse(`{"rows": [{"id": "a", "${key}": 1}]}`))]).toEqual([key, false]);
      expect([key, ok(JSON.parse(`{"grid": {"${key}": {"q1": 1}}}`))]).toEqual([key, false]);
    }
  });
});
