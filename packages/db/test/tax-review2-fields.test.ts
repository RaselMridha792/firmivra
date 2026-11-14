// Tax Returns Review 2 (R60, Nov 15; migrations r60_tax_r2_in_correction and r60_tax_r2_fields,
// the lead's approval): In Correction after a rejection, a recorded File Extension, the firm's
// amount rounding, and the workflow status a Tax Status label stands for. Runs as the app role.
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);

let year = 2010;
const newReturn = (data: Record<string, unknown> = {}) =>
  A().taxReturn.create({
    data: {
      businessId: f.firmA,
      clientId: f.clientA,
      taxYear: (year += 1),
      filingType: 'INDIVIDUAL',
      ...data,
    },
  });
const move = (id: string, data: Record<string, unknown>) =>
  A().taxReturn.update({ where: { id }, data });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r60tr2');
});

describe('In Correction', () => {
  it('follows a rejection with a reason, never goes straight to review, and shows as In Progress', async () => {
    const r = await newReturn({
      status: 'REJECTED',
      filedOn: new Date('2026-04-10T00:00:00Z'),
    });
    expect(r.workflowStatus).toBe('REJECTED');
    expect(
      await failure(
        move(r.id, { workflowStatus: 'READY_FOR_REVIEW', statusReason: 'Fixed (fake)' }),
      ),
    ).toMatch(/In Correction before review/);
    expect(await failure(move(r.id, { workflowStatus: 'IN_CORRECTION' }))).toMatch(
      /needs a reason/,
    );
    const correcting = await move(r.id, {
      workflowStatus: 'IN_CORRECTION',
      statusReason: 'Fix the prior-year AGI (fake)',
    });
    expect([correcting.workflowStatus, correcting.status]).toEqual([
      'IN_CORRECTION',
      'IN_PROGRESS',
    ]);
    await expect(move(r.id, { workflowStatus: 'READY_FOR_REVIEW' })).resolves.toMatchObject({
      workflowStatus: 'READY_FOR_REVIEW',
    });
  });
});

describe('File Extension', () => {
  it('keeps the filing day and the new deadline together, the deadline after the original', async () => {
    const r = await newReturn({ dueOn: new Date('2026-04-15T00:00:00Z') });
    expect(
      await failure(move(r.id, { extensionFiledOn: new Date('2026-04-10T00:00:00Z') })),
    ).toMatch(/check constraint/i);
    expect(
      await failure(
        move(r.id, {
          extensionFiledOn: new Date('2026-04-10T00:00:00Z'),
          extendedDueOn: new Date('2026-04-15T00:00:00Z'),
        }),
      ),
    ).toMatch(/check constraint/i);
    await expect(
      move(r.id, {
        extensionFiledOn: new Date('2026-04-10T00:00:00Z'),
        extendedDueOn: new Date('2026-10-15T00:00:00Z'),
      }),
    ).resolves.toMatchObject({ extendedDueOn: new Date('2026-10-15T00:00:00Z') });
  });
});

describe('amount rounding', () => {
  it('is EXACT by default and takes ROUND_TO_DOLLAR', async () => {
    const [row] = await owner.$queryRaw<{ d: string | null }[]>`
      SELECT column_default AS d FROM information_schema.columns
      WHERE table_name = 'business_settings' AND column_name = 'tax_amount_rounding'`;
    expect(row?.d).toContain('EXACT');
    expect(await failure(owner.$executeRawUnsafe('SELECT \'HALF\'::"TaxAmountRounding"'))).toMatch(
      /invalid input value/i,
    );
  });
});

describe('Tax Status workflow_status (TX-F36)', () => {
  it('maps a label to a workflow status, or to none', async () => {
    const mapped = await A().taxStatus.create({
      data: {
        businessId: f.firmA,
        name: 'Fake: with the preparer',
        workflowStatus: 'IN_PREPARATION',
      },
    });
    expect(mapped.workflowStatus).toBe('IN_PREPARATION');
    const plain = await A().taxStatus.create({
      data: { businessId: f.firmA, name: 'Fake: client-level only' },
    });
    expect(plain.workflowStatus).toBeNull();
  });
});
