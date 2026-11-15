import { INTAKE_FILE_SIZE_CHOICES } from '@firmivra/types';
import { describe, expect, it } from 'vitest';
import { fileSizeOptions, legacyRetentionNote } from './settings-model';

describe('fileSizeOptions (Max file size per file, I10)', () => {
  it('offers 2, 5, 10, 50 and 100 MB when the saved size is one of them', () => {
    expect(fileSizeOptions(10)).toEqual([2, 5, 10, 50, 100]);
    expect(fileSizeOptions(10, 50)).toEqual([...INTAKE_FILE_SIZE_CHOICES]);
    expect(fileSizeOptions(null)).toEqual([...INTAKE_FILE_SIZE_CHOICES]);
  });

  it("keeps a firm's older saved size, in order, also while another one is chosen", () => {
    expect(fileSizeOptions(25)).toEqual([2, 5, 10, 25, 50, 100]);
    expect(fileSizeOptions(25, 50)).toEqual([2, 5, 10, 25, 50, 100]);
  });

  it('no longer offers the older size once another one is saved', () => {
    expect(fileSizeOptions(50, 50)).not.toContain(25);
  });
});

describe('legacyRetentionNote (Apply to all saved under I12, Review Two 14b)', () => {
  it('shows a saved 50 as it is, with how to change it', () => {
    expect(legacyRetentionNote(50, 50)).toBe('50 years (saved before; choose 1–30 to change)');
  });
  it('says nothing for 1 to 30, nothing saved, or once the value is being changed', () => {
    expect(legacyRetentionNote(30, 30)).toBeNull();
    expect(legacyRetentionNote(null, null)).toBeNull();
    expect(legacyRetentionNote(50, 12)).toBeNull();
    expect(legacyRetentionNote(50, null)).toBeNull();
  });
});
