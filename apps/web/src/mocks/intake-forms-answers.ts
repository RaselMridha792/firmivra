import type { AssignedFormRecord, IntakeAnswers } from '@firmivra/types';

/**
 * Synthetic answers for the Intake Form submission detail (the Annual Tax form), so every card of
 * the Overview and every section of Responses has something to show. Invented people only. A form
 * nobody has submitted yet answers only what the client has typed so far.
 */
export function mockIntakeAnswers(record: AssignedFormRecord): IntakeAnswers {
  const [first = 'Sample', ...rest] = record.recipient.name.split(' ');
  const last = rest.join(' ') || 'Client';
  const started = record.status !== 'SENT';
  const submitted = ['SUBMITTED', 'UNDER_REVIEW', 'COMPLETED'].includes(record.status);
  if (!started) return {};
  const personal: IntakeAnswers = {
    firstName: first,
    lastName: last,
    email: record.recipient.email ?? 'client@example.test',
    phone: record.recipient.phone ?? '(555) 040-1000',
    dateOfBirth: '1991-07-14',
    ssn: { last4: '4821' },
    filingStatus: 'SINGLE',
  };
  if (!submitted) return personal;
  return {
    ...personal,
    street: '1884 Willow Creek Dr',
    city: 'Atlanta',
    state: 'GA',
    zip: '30318',
    claimedAsDependent: false,
    returnTypes: ['PERSONAL'],
    legalStatus: 'US_CITIZEN',
    armedForces: false,
    hasDependents: true,
    dependents: [
      {
        id: 'dep-1',
        firstName: 'Marcus',
        lastName: last,
        dateOfBirth: '2018-03-09',
        relationship: 'SON',
        ssn: { last4: '1177' },
        livesWithYou: true,
        fullTimeStudent: false,
        disabled: false,
        childTaxCredit: true,
      },
    ],
    studentLoanInterest: true,
    retirementContributions: false,
    hsaContributions: false,
    educationExpenses: false,
    mortgageInterest: true,
    realEstateTaxes: true,
    charitableContributions: true,
    medicalExpenses: false,
    childCareExpenses: true,
    energyImprovements: false,
    otherDeductions: false,
    incomeWages: true,
    incomeSelfEmployment: false,
    incomeBusiness: false,
    incomeInterest: true,
    incomeDividends: false,
    incomeRetirement: false,
    incomeUnemployment: false,
    incomeRental: false,
    incomeAlimony: false,
    incomeOther: true,
    incomeDetails: 'Small freelance payment from a one-time design project.',
    comments: 'Please call after 5 PM if anything is missing.',
  };
}
