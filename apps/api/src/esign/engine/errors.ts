import type { EsignErrorCode } from '@firmivra/types';

export type EsignEngineErrorCode = Extract<
  EsignErrorCode,
  'PDF_ENCRYPTED' | 'PDF_UNREADABLE' | 'TOO_MANY_PAGES'
>;

/** A file the engine refuses. The API answers it as 409 with the same code. */
export class EsignEngineError extends Error {
  constructor(readonly code: EsignEngineErrorCode) {
    super(code);
    this.name = 'EsignEngineError';
  }
}

/** A caller's mistake (a plan or stamp naming a page that is not there): a bug, never a 409. */
export class EsignPlanError extends RangeError {
  override name = 'EsignPlanError';
}
