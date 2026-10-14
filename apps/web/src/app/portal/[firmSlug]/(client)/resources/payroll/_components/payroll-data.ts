import {
  Building2,
  ClipboardCheck,
  FileText,
  PlayCircle,
  UserPlus,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';

export const setupSteps: { icon: LucideIcon; title: string; detail: string | string[] }[] = [
  {
    icon: Building2,
    title: 'Determine Your Business Structure',
    detail: 'Your structure (Sole Proprietor, LLC, S Corp, etc.) affects payroll responsibilities.',
  },
  {
    icon: UserPlus,
    title: 'Get an EIN (Employer Identification Number)',
    detail: 'Required if you have employees.',
  },
  {
    icon: FileText,
    title: 'Register for State Employer Accounts',
    detail:
      'Register with your state department of revenue for state payroll taxes and unemployment.',
  },
  {
    icon: UsersRound,
    title: 'Choose a Payroll Method',
    detail: [
      'In-house payroll software',
      'Work with a payroll provider',
      'Partner with an accountant (we can help!)',
    ],
  },
  {
    icon: ClipboardCheck,
    title: 'Set Up Payroll System',
    detail: 'Enter employee information, set pay schedules, and configure tax withholdings.',
  },
  {
    icon: PlayCircle,
    title: 'Run Your First Payroll',
    detail: 'Review for accuracy and ensure all taxes are withheld and reported on time.',
  },
];

export const compliance = [
  'Withhold and pay federal income tax, Social Security, and Medicare (FICA)',
  'Pay federal and state unemployment taxes (FUTA & SUTA)',
  'Provide employees with Form W-2 by January 31',
  'File quarterly payroll tax returns (Form 941)',
  'Report new hires to the state (usually within 20 days)',
  'Comply with state-specific payroll requirements',
  'Maintain accurate payroll records for at least 4 years',
  'Follow labor laws (minimum wage, overtime, etc.)',
];

export const forms = [
  ['Form W-4', 'Employee Withholding Certificate'],
  ['Form W-2', 'Wage and Tax Statement (employees)'],
  ['Form 1099-NEC', 'Nonemployee Compensation (contractors)'],
  ['Form 941', 'Quarterly Federal Tax Return'],
  ['Form 940', 'Annual Federal Unemployment Tax Return'],
  ['State Withholding Forms', 'Varies by state'],
];

export const practices = [
  'Use a reliable payroll system or provider',
  'Keep employee and contractor information up to date',
  'Run payroll on a consistent schedule',
  'Reconcile payroll reports with your bank account',
  'Stay informed about tax rate changes',
  'Maintain organized records (digital and/or paper)',
  'Work with a tax professional to ensure compliance',
  'Conduct regular payroll audits',
];

export const deadlines = [
  ['New Hire Reporting', 'Within 20 days of hire (varies by state)'],
  ['Quarterly Payroll Tax Returns (Form 941)', 'Due April 30, July 31, October 31, January 31'],
  ['Annual Unemployment Tax Return (Form 940)', 'Due January 31'],
  ['W-2 Forms to Employees', 'By January 31'],
  ['1099-NEC to Contractors', 'By January 31 (if paid $600+ in a year)'],
];

export const records = [
  'Payroll registers and reports',
  'Employee time records',
  'Tax deposit records',
  'Tax returns (Forms 941, 940)',
  'W-2s and 1099s',
  'Bank statements and payment confirmations',
  'Employee and contractor information (I-9, W-4, etc.)',
];

export const reminders = [
  'Always classify workers correctly',
  'Pay payroll taxes on time to avoid penalties',
  'Review state-specific requirements',
  'Keep up with changing tax laws',
  'Consider professional support for growing teams',
];
