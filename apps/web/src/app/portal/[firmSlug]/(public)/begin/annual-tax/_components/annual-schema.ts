import {
  Address,
  BusinessSummary,
  CalendarDate,
  Email,
  Phone,
  PortalInfo,
  ApiError,
} from '@firmivra/types';
import {
  businessStructures,
  dependentFlags,
  deductionQuestions,
  documentCategories,
  expenseRows,
  filingStatuses,
  financialSections,
  hasBusiness,
  hasSpouse,
  identitySlots,
  incomeQuestions,
  legalStatuses,
  relationships,
  returnTypes,
  states,
  type DocumentId,
} from './annual-data';

// UI-only schemas reuse the shared Zod primitives. R11 owns the eventual submission contract.
const object = Address.pick({});
const text = BusinessSummary.shape.name.trim().max(1000);
const boolean = PortalInfo.shape.signUpOpen;
const address = object.extend({ street: text, city: text, state: text, zip: text });
const person = object.extend({ first: text, middle: text, last: text, dob: text, ssn: text });
const spouse = person.extend({
  occupation: text,
  employer: text,
  phone: text,
  email: text,
  address,
});
const dependent = person.extend({ relationship: text, flags: text.array() });
const business = object.extend({
  structure: text,
  otherStructure: text,
  name: text,
  ein: text,
  address,
  activity: text,
  products: text,
});
const row = object.extend({ description: text, quarters: text.array().length(4), annual: text });
const selectedFile = object.extend({
  id: text,
  file: ApiError.shape.error.shape.details
    .unwrap()
    .refine((value) => typeof File !== 'undefined' && value instanceof File, 'Select a valid file')
    .transform((value) => value as File),
  selectedAt: CalendarDate,
});
const document = object.extend({ files: selectedFile.array(), unavailable: boolean, reason: text });
const documents = object.extend({
  governmentId: document,
  spouseGovernmentId: document,
  socialSecurityCard: document,
  spouseSocialSecurityCard: document,
  dependentDocuments: document,
  incomeDocuments: document,
  deductionsDocuments: document,
  businessDocuments: document,
  formationDocuments: document,
});
const base = object.extend({
  personal: person.extend({ phone: text, email: text, address }),
  filingStatus: text,
  claimedDependent: text,
  returnTypes: text.array(),
  legalStatus: text,
  military: text,
  spouse,
  hasDependents: text,
  dependents: dependent.array(),
  deductions: text.array().length(11),
  income: text.array().length(10),
  incomeDescription: text,
  businesses: business.array(),
  comments: text,
  businessIncome: row.array(),
  payroll: row.array(),
  taxPayments: row.array(),
  expenses: row.array(),
  documents,
  certified: boolean,
  payment: text,
  agreed: boolean,
  signature: text,
  signatureDate: text,
});
export type AnnualValues = ReturnType<typeof base.parse>;
export type DocumentValue = AnnualValues['documents'][DocumentId];
export type FinancialRow = AnnualValues['businessIncome'][number];
export const emptyAddress = () => ({ street: '', city: '', state: '', zip: '' });
export const emptyPerson = () => ({ first: '', middle: '', last: '', dob: '', ssn: '' });
export const emptyDependent = () => ({ ...emptyPerson(), relationship: '', flags: [] });
export const emptyBusiness = () => ({
  structure: '',
  otherStructure: '',
  name: '',
  ein: '',
  address: emptyAddress(),
  activity: '',
  products: '',
});
export const emptyRow = () => ({ description: '', quarters: ['', '', '', ''], annual: '' });
export const emptyDocument = (): DocumentValue => ({ files: [], unavailable: false, reason: '' });
export function initialValues(): AnnualValues {
  return {
    personal: { ...emptyPerson(), phone: '', email: '', address: emptyAddress() },
    filingStatus: '',
    claimedDependent: '',
    returnTypes: [],
    legalStatus: '',
    military: '',
    spouse: {
      ...emptyPerson(),
      occupation: '',
      employer: '',
      phone: '',
      email: '',
      address: emptyAddress(),
    },
    hasDependents: '',
    dependents: [emptyDependent()],
    deductions: deductionQuestions.map(() => ''),
    income: incomeQuestions.map(() => ''),
    incomeDescription: '',
    businesses: [emptyBusiness()],
    comments: '',
    businessIncome: financialSections[0].rows.map(emptyRow),
    payroll: financialSections[1].rows.map(emptyRow),
    taxPayments: financialSections[2].rows.map(emptyRow),
    expenses: expenseRows.map(emptyRow),
    documents: {
      governmentId: emptyDocument(),
      spouseGovernmentId: emptyDocument(),
      socialSecurityCard: emptyDocument(),
      spouseSocialSecurityCard: emptyDocument(),
      dependentDocuments: emptyDocument(),
      incomeDocuments: emptyDocument(),
      deductionsDocuments: emptyDocument(),
      businessDocuments: emptyDocument(),
      formationDocuments: emptyDocument(),
    },
    certified: false,
    payment: '',
    agreed: false,
    signature: '',
    signatureDate: '',
  };
}
export function requiredDocumentIds(data: AnnualValues): DocumentId[] {
  const ids: DocumentId[] = ['governmentId', 'socialSecurityCard'];
  if (hasSpouse(data.filingStatus)) ids.push('spouseGovernmentId', 'spouseSocialSecurityCard');
  if (data.hasDependents === 'Yes') ids.push('dependentDocuments');
  if (data.income.some((value) => value === 'Yes')) ids.push('incomeDocuments');
  if (data.deductions.some((value) => value === 'Yes')) ids.push('deductionsDocuments');
  if (hasBusiness(data.returnTypes)) ids.push('businessDocuments', 'formationDocuments');
  return ids;
}
export function annualSchema(step: number, today: string) {
  return base.superRefine((data, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    const required = (value: string, path: (string | number)[], label: string) => {
      if (!value.trim()) issue(path, `${label} is required.`);
    };
    const choice = (
      value: string,
      choices: readonly string[],
      path: (string | number)[],
      label: string,
    ) => {
      if (!choices.includes(value)) issue(path, `Please select ${label}.`);
    };
    const date = (value: string, path: (string | number)[]) => {
      if (!CalendarDate.safeParse(value).success || value > today)
        issue(path, 'Enter a valid date that is not in the future.');
    };
    const ssn = (value: string, path: (string | number)[], optional = false) => {
      if ((!optional || value) && !/^\d{9}$/.test(value)) issue(path, 'Enter all 9 digits.');
    };
    const validAddress = (
      value: AnnualValues['personal']['address'],
      path: (string | number)[],
    ) => {
      required(value.street, [...path, 'street'], 'Street address');
      required(value.city, [...path, 'city'], 'City');
      choice(value.state, states, [...path, 'state'], 'a state');
      if (!/^\d{5}(-\d{4})?$/.test(value.zip)) issue([...path, 'zip'], 'Enter a valid ZIP code.');
    };
    const validPerson = (
      value: AnnualValues['dependents'][number] | AnnualValues['personal'],
      path: (string | number)[],
      optionalSsn = false,
    ) => {
      required(value.first, [...path, 'first'], 'First name');
      required(value.last, [...path, 'last'], 'Last name');
      date(value.dob, [...path, 'dob']);
      ssn(value.ssn, [...path, 'ssn'], optionalSsn);
    };
    const validPhone = (value: string, path: (string | number)[]) => {
      const digits = value.replace(/\D/g, '');
      if (!Phone.safeParse(digits.length === 10 ? `+1${digits}` : `+${digits}`).success)
        issue(path, 'Enter a valid U.S. phone number.');
    };
    if (step === 1 || step === 4) {
      validPerson(data.personal, ['personal']);
      validAddress(data.personal.address, ['personal', 'address']);
      validPhone(data.personal.phone, ['personal', 'phone']);
      if (!Email.safeParse(data.personal.email).success)
        issue(['personal', 'email'], 'Enter a valid email address.');
      choice(data.filingStatus, filingStatuses, ['filingStatus'], 'your filing status');
      choice(data.claimedDependent, ['Yes', 'No'], ['claimedDependent'], 'Yes or No');
      if (
        data.returnTypes.length !== 1 ||
        data.returnTypes.some((value) => !returnTypes.includes(value))
      )
        issue(['returnTypes'], 'Select one type of tax return.');
      choice(data.legalStatus, legalStatuses, ['legalStatus'], 'your legal status');
      choice(data.military, ['Yes', 'No'], ['military'], 'Yes or No');
      choice(data.hasDependents, ['Yes', 'No'], ['hasDependents'], 'Yes or No');
      if (hasSpouse(data.filingStatus)) {
        validPerson(data.spouse, ['spouse']);
        if (data.spouse.email && !Email.safeParse(data.spouse.email).success)
          issue(['spouse', 'email'], 'Enter a valid email address.');
        if (data.spouse.phone) validPhone(data.spouse.phone, ['spouse', 'phone']);
        if (Object.values(data.spouse.address).some(Boolean))
          validAddress(data.spouse.address, ['spouse', 'address']);
      }
      if (data.hasDependents === 'Yes') {
        if (!data.dependents.length) issue(['dependents'], 'Add at least one dependent.');
        data.dependents.forEach((value, index) => {
          validPerson(value, ['dependents', index], true);
          choice(
            value.relationship,
            relationships,
            ['dependents', index, 'relationship'],
            'a relationship',
          );
          if (value.flags.some((flag) => !dependentFlags.includes(flag)))
            issue(['dependents', index, 'flags'], 'Select valid dependent details.');
        });
      }
      data.deductions.forEach((value, index) =>
        choice(value, ['Yes', 'No'], ['deductions', index], 'Yes or No'),
      );
      data.income.forEach((value, index) =>
        choice(value, ['Yes', 'No'], ['income', index], 'Yes or No'),
      );
      if (data.income[9] === 'Yes')
        required(data.incomeDescription, ['incomeDescription'], 'Other income description');
      if (hasBusiness(data.returnTypes)) {
        if (!data.businesses.length) issue(['businesses'], 'Add at least one business.');
        data.businesses.forEach((value, index) => {
          const path = ['businesses', index];
          choice(
            value.structure,
            businessStructures,
            [...path, 'structure'],
            'a business structure',
          );
          if (value.structure === 'Other')
            required(value.otherStructure, [...path, 'otherStructure'], 'Business structure');
          required(value.name, [...path, 'name'], 'Business legal name');
          ssn(value.ein, [...path, 'ein']);
          validAddress(value.address, [...path, 'address']);
          choice(
            value.activity,
            ['Goods (Products)', 'Services'],
            [...path, 'activity'],
            'Goods or Services',
          );
          required(value.products, [...path, 'products'], 'Products or services');
        });
      }
    }
    if ((step === 2 || step === 4) && hasBusiness(data.returnTypes)) {
      for (const key of ['businessIncome', 'payroll', 'taxPayments', 'expenses'] as const)
        data[key].forEach((value, index) => {
          const values = key === 'expenses' ? [value.annual] : value.quarters;
          values.forEach((amount, quarter) => {
            if (amount && !/^\d{1,10}(\.\d{1,2})?$/.test(amount))
              issue(
                [key, index, ...(key === 'expenses' ? ['annual'] : ['quarters', quarter])],
                'Enter a non-negative amount with up to 2 decimal places.',
              );
          });
        });
    }
    if (step === 3 || step === 4) {
      const requiredIds = requiredDocumentIds(data);
      for (const { id } of [...identitySlots, ...documentCategories]) {
        const slot = data.documents[id];
        if (slot.unavailable && !slot.reason.trim())
          issue(['documents', id, 'reason'], 'Please explain why you do not have this document.');
        if (requiredIds.includes(id) && !slot.files.length && !slot.unavailable)
          issue(['documents', id], 'Select a document or explain why it is unavailable.');
        slot.files.forEach(({ file }) => {
          if (file.size > 10 * 1024 * 1024 || !/\.(pdf|jpe?g|png)$/i.test(file.name))
            issue(['documents', id], 'Use PDF, JPG or PNG files, up to 10 MB each.');
        });
      }
      if (!data.certified)
        issue(['certified'], 'Confirm that your documents and information are accurate.');
    }
    if (step === 4) {
      choice(data.payment, ['refund', 'now', 'after'], ['payment'], 'a payment preference');
      if (
        data.payment === 'refund' &&
        (hasBusiness(data.returnTypes) ||
          data.income[0] !== 'Yes' ||
          data.income.slice(1).some((value) => value === 'Yes'))
      )
        issue(['payment'], 'Pay from refund is available for W-2 personal tax returns only.');
      if (!data.agreed) issue(['agreed'], 'Please read and accept the service agreement.');
      required(data.signature, ['signature'], 'Typed signature');
      date(data.signatureDate, ['signatureDate']);
    }
  });
}
