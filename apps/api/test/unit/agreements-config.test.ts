import { describe, expect, it } from 'vitest';
import { agreementsConfig } from '../../src/agreements/agreements.service.js';

describe('agreementsConfig', () => {
  it('leaves the PDF rule off when unset or empty, until the PDF routes land', () => {
    expect(agreementsConfig({})).toEqual({ pdfRequired: false });
    expect(agreementsConfig({ AGREEMENT_PDF_REQUIRED: '' })).toEqual({ pdfRequired: false });
  });

  it('reads true and false, and refuses anything else', () => {
    expect(agreementsConfig({ AGREEMENT_PDF_REQUIRED: 'true' })).toEqual({ pdfRequired: true });
    expect(agreementsConfig({ AGREEMENT_PDF_REQUIRED: 'false' })).toEqual({ pdfRequired: false });
    expect(() => agreementsConfig({ AGREEMENT_PDF_REQUIRED: 'yes' })).toThrow();
  });
});
