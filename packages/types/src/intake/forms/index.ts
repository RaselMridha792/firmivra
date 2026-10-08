import type { IntakeFormDefinition, IntakeFormKey } from '../definition.js';
import { ANNUAL_TAX_FORM } from './annual-tax.js';

/**
 * The built-in form definitions, version 1 of each: every firm's forms start from these (the API
 * seeds them per firm and service; a firm's own changes are a new version). The screens get the
 * definition with each draft or intake; the mocks and tests use these. Typed as partial (look a
 * form up and handle a missing one): only Annual Tax is here yet, and the other five forms arrive
 * in their own PR without changing callers.
 */
export const INTAKE_FORMS: Readonly<Partial<Record<IntakeFormKey, IntakeFormDefinition>>> = {
  ANNUAL_TAX: ANNUAL_TAX_FORM,
};
