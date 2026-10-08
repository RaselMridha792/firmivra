import { z } from 'zod';

// Choice lists the six form definitions share: one list each, code (stored) and label (shown), so
// a change is one line. Octavia confirms them; never remove a code that answers use, add one.

/** `{ CODE: 'Label' }` to a z.enum of its codes (as R4's firm-applications lists). */
const codes = <T extends Record<string, string>>(labels: T) =>
  z.enum(Object.keys(labels) as [Extract<keyof T, string>, ...Extract<keyof T, string>[]]);

/** The 50 states and DC, for every `state` field (the beta serves US firms only). */
export const US_STATES = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
} as const;
export const UsState = codes(US_STATES);
export type UsState = z.infer<typeof UsState>;

export const MONTHS = {
  JAN: 'January',
  FEB: 'February',
  MAR: 'March',
  APR: 'April',
  MAY: 'May',
  JUN: 'June',
  JUL: 'July',
  AUG: 'August',
  SEP: 'September',
  OCT: 'October',
  NOV: 'November',
  DEC: 'December',
} as const;

export const QUARTERS = {
  Q1: 'Q1 (Jan \u2013 Mar)',
  Q2: 'Q2 (Apr \u2013 Jun)',
  Q3: 'Q3 (Jul \u2013 Sep)',
  Q4: 'Q4 (Oct \u2013 Dec)',
} as const;

export const FILING_STATUSES = {
  SINGLE: 'Single',
  MARRIED_FILING_JOINTLY: 'Married Filing Jointly',
  MARRIED_FILING_SEPARATELY: 'Married Filing Separately',
  HEAD_OF_HOUSEHOLD: 'Head of Household',
  QUALIFYING_SURVIVING_SPOUSE: 'Qualifying Surviving Spouse',
} as const;

/** Quarterly Tax's list; Payroll and Tax Planning use it as a dropdown. */
export const BUSINESS_STRUCTURES = {
  SOLE_PROPRIETORSHIP: 'Sole Proprietorship',
  PARTNERSHIP: 'Partnership',
  S_CORP: 'S Corporation (S-Corp)',
  C_CORP: 'C Corporation (C-Corp)',
  LLC_SINGLE_MEMBER: 'LLC (Single Member)',
  LLC_MULTI_MEMBER: 'LLC (Multi-Member)',
  OTHER: 'Other (please specify)',
} as const;

/** "How did you hear about us?": the mockups show a dropdown without its options. */
export const HEARD_ABOUT = {
  SEARCH: 'Google or another search engine',
  SOCIAL_MEDIA: 'Social media',
  REFERRAL: 'A friend, family member or client',
  EXISTING_CLIENT: 'I am already a client',
  EVENT: 'An event or workshop',
  OTHER: 'Other',
} as const;

/** Single-choice answers drawn as checkboxes in the mockups (Tax Planning, Business Development). */
export const YES_NO_PREVIOUSLY = {
  YES: 'Yes',
  NO: 'No',
  PREVIOUSLY: 'I had one previously',
} as const;

export const ACCOUNTING_METHODS = {
  CASH: 'Cash Basis',
  ACCRUAL: 'Accrual Basis',
  NOT_SURE: 'Not Sure',
} as const;
