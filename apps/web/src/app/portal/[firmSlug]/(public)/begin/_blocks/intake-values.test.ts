import { ApiRequestError } from '@firmivra/types';
import { describe, expect, it } from 'vitest';
import { checkFirmFileSize, firmFileSize } from './intake-values';

const MB = 1024 * 1024;

describe("the firm's file size limit on Begin Online's upload fields (I10)", () => {
  it("names the firm's own limit, held to the platform's 100 MB", () => {
    expect(firmFileSize(10)).toBe('10 MB');
    expect(firmFileSize(50)).toBe('50 MB');
    expect(firmFileSize(500)).toBe('100 MB');
  });

  it('lets a file up to the limit through', () => {
    expect(() => checkFirmFileSize({ size: 10 * MB }, 10)).not.toThrow();
    expect(() => checkFirmFileSize({ size: 40 * MB }, 50)).not.toThrow();
  });

  it("refuses a larger one before sending, in the upload ticket's words", () => {
    let caught: unknown;
    try {
      checkFirmFileSize({ size: 10 * MB + 1 }, 10);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiRequestError);
    expect(caught).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      details: [{ path: 'sizeBytes', message: 'Files can be at most 10 MB' }],
    });
    expect(() => checkFirmFileSize({ size: 3 * MB }, 2)).toThrow('Files can be at most 2 MB');
  });
});
