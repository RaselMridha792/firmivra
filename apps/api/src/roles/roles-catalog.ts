import type { MembershipRole, PermissionCapability, PermissionModule } from '@firmivra/types';

// What the Users & Roles and Create Staff screens say about each role, module and capability.
// Served from code: the words are the product's, not the firm's data.

export const ROLE_DESCRIPTIONS: Record<MembershipRole, string> = {
  OWNER: 'Full control of the firm, its billing and its team. Cannot be changed.',
  ADMIN: 'Runs the firm day to day: staff, settings and every module.',
  MANAGER: 'Oversees the work and the team; reads most modules and works clients and tasks.',
  STAFF: 'Works their assigned clients: documents, tasks, appointments, messages and returns.',
  BOOKKEEPER: 'Keeps the books for their clients; reads clients and invoices.',
  TAX_PREPARER: 'Prepares returns for their clients; reads the other business modules.',
  CLIENT_SUPPORT: 'Answers clients and books appointments; reads the rest.',
  READ_ONLY: 'Looks but does not change: can view the modules they are given.',
};

const mod = (label: string, description: string) => ({ label, description });

export const MODULE_INFO: Record<PermissionModule, { label: string; description: string }> = {
  DASHBOARD: mod('Dashboard', 'The firm overview and its numbers.'),
  CLIENTS: mod('Clients', 'Client records, contacts and their history.'),
  LEADS: mod('Leads', 'Leads from Begin Online and other sources, and converting them.'),
  APPOINTMENTS: mod('Appointments', 'The calendar, bookings and availability.'),
  INTAKE_FORMS: mod('Intake Forms', 'Forms sent to clients and their answers.'),
  DOCUMENTS: mod('Documents', 'Client files, requests and downloads.'),
  CLIENT_PORTAL: mod('Client Portal', 'What clients see and do in their portal.'),
  TASKS: mod('Tasks', 'Tasks, templates and recurring work.'),
  TAX_RETURNS: mod('Tax Returns', 'Return preparation, review and filing status.'),
  BOOKKEEPING: mod('Bookkeeping', 'Client books, reconciliation and reports.'),
  PAYROLL: mod('Payroll', 'Workers, pay runs and year-end forms.'),
  TAX_PLANNING: mod('Tax Planning', 'Plans, savings estimates and opportunities.'),
  BUSINESS_ADVISORY: mod('Business Advisory', 'Advisory clients, plans, goals and health scores.'),
  INVOICES_PAYMENTS: mod('Invoices & Payments', 'Invoices, payments and recurring billing.'),
  MESSAGES: mod('Messages', 'Secure messages with clients.'),
  COMMUNICATIONS: mod(
    'Communications',
    'Bulk email, text and announcements, segments and consent.',
  ),
  AUTOMATIONS: mod('Automations', 'Rules that create tasks, messages and notes on their own.'),
  COMPLIANCE: mod('Compliance', 'Deadlines and what each client owes.'),
  REPORTS: mod('Reports', 'The report library, builder, exports and schedules.'),
  TEMPLATES: mod('Templates', 'Message and document templates and their library.'),
  SERVICES_PRICING: mod('Services & Pricing', 'The service catalog, packages and promotions.'),
  STAFF_MANAGEMENT: mod('Staff Management', 'Staff, departments, teams and roles.'),
  INTEGRATIONS: mod('Integrations', 'Connected apps and their data.'),
  SETTINGS: mod('Settings', 'Company profile, billing, security and branding.'),
};

export const CAPABILITY_INFO: Record<PermissionCapability, { label: string; description: string }> =
  {
    VIEW: { label: 'View', description: 'See the module and its records.' },
    CREATE: { label: 'Create', description: 'Add new records.' },
    EDIT: { label: 'Edit', description: 'Change existing records.' },
    DELETE: { label: 'Delete', description: 'Remove or archive records.' },
    APPROVE: { label: 'Approve', description: 'Approve, send or override on behalf of the firm.' },
    MANAGE: { label: 'Manage', description: 'Configure the module and its access.' },
    EXPORT: { label: 'Export', description: 'Download data out of the module.' },
  };
