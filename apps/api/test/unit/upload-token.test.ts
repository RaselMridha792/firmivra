import { describe, expect, it } from 'vitest';
import { type UploadClaim, UploadTokens } from '../../src/storage/upload-token.js';

const tokens = new UploadTokens({ CLIENT: 'synthetic-client-secret-0123456789abcdef' });
const claim: UploadClaim = {
  pool: 'CLIENT',
  businessId: '0199b6a0-0000-7000-8000-000000000001',
  userId: '0199b6a0-0000-7000-8000-000000000002',
  clientAccountId: '0199b6a0-0000-7000-8000-000000000003',
  clientId: '0199b6a0-0000-7000-8000-000000000004',
  engagementId: '0199b6a0-0000-7000-8000-000000000005',
  requestId: null,
  categoryId: null,
  direction: 'CLIENT_TO_FIRM',
  taxYear: 2025,
  key: 'tenant/0199b6a0-0000-7000-8000-000000000001/documents/x',
  fileName: 'w2.pdf',
  contentType: 'application/pdf',
  sizeBytes: 1024,
  sha256: 'a'.repeat(64),
};

describe('upload tickets', () => {
  it('carry an intake upload slot sealed with the rest', async () => {
    const withSlot = {
      ...claim,
      intakeId: '0199b6a0-0000-7000-8000-000000000006',
      intakeSlot: 'incomeDocuments',
    };
    const opened = await tokens.open(await tokens.seal(withSlot, 60), 'CLIENT');
    expect(opened?.value).toMatchObject({
      intakeId: withSlot.intakeId,
      intakeSlot: 'incomeDocuments',
    });
    const plain = await tokens.open(await tokens.seal(claim, 60), 'CLIENT');
    expect(plain?.value.intakeId).toBeUndefined();
  });

  it('never open with half an intake slot or a slot that is not a field key', async () => {
    for (const bad of [
      { intakeId: '0199b6a0-0000-7000-8000-000000000006' },
      { intakeSlot: 'incomeDocuments' },
      { intakeId: '0199b6a0-0000-7000-8000-000000000006', intakeSlot: '../x' },
    ]) {
      const token = await tokens.seal({ ...claim, ...bad } as UploadClaim, 60);
      expect(await tokens.open(token, 'CLIENT')).toBeUndefined();
    }
  });
});
