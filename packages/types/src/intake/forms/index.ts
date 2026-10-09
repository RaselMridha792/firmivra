import type { IntakeFormDefinition, IntakeFormKey } from '../definition.js';
import { ANNUAL_TAX_FORM } from './annual-tax.js';
import { BOOKKEEPING_FORM } from './bookkeeping.js';
import { BUSINESS_DEVELOPMENT_FORM } from './business-development.js';
import { PAYROLL_FORM } from './payroll.js';
import { QUARTERLY_TAX_FORM } from './quarterly-tax.js';
import { TAX_PLANNING_FORM } from './tax-planning.js';

/**
 * The built-in form definitions, version 1 of each: every firm's forms start from these (the API
 * seeds them per firm and service; a firm's own changes are a new version). The screens get the
 * definition with each draft or intake; the mocks and tests use these. All six services are here;
 * the type stays partial so callers keep handling a missing form (a firm's service may have none
 * published).
 *
 * Every form asks, on its first step and required, for `email` and `phone` (the person Begin
 * Online writes to and the lead's contact) and for a name: `fullName`, or `firstName` and
 * `lastName`. Most also have `businessName`. The API reads the lead's contact from these keys.
 */
export const INTAKE_FORMS: Readonly<Partial<Record<IntakeFormKey, IntakeFormDefinition>>> = {
  ANNUAL_TAX: ANNUAL_TAX_FORM,
  QUARTERLY_TAX: QUARTERLY_TAX_FORM,
  BOOKKEEPING: BOOKKEEPING_FORM,
  PAYROLL: PAYROLL_FORM,
  TAX_PLANNING: TAX_PLANNING_FORM,
  BUSINESS_DEVELOPMENT: BUSINESS_DEVELOPMENT_FORM,
};
