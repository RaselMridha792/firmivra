import {
  createAdminSupportAccessClient,
  createAgreementsClient,
  createApiClient,
  createAppointmentsClient,
  createAppointmentTypesClient,
  createAuditLogClient,
  createAvailabilityClient,
  createBrandingClient,
  createBeginOnlineClient,
  createCalculatorsClient,
  createClientNotesClient,
  createClientsClient,
  createClientSignUpsClient,
  createContentClient,
  createDocumentsClient,
  createEngagementsClient,
  createEsignClient,
  createFirmApplicationsClient,
  createIntakeFormsClient,
  createInvoicesClient,
  createLeadPipelineClient,
  createLeadsClient,
  createDashboardClient,
  createDepartmentsClient,
  createMessagesClient,
  createMyAppointmentsClient,
  createMyCalculatorsClient,
  createPublicCalculatorsClient,
  createMyContentClient,
  createMyDocumentsClient,
  createMyIntakesClient,
  createMyIntakeAgreementsClient,
  createMyInvoicesClient,
  createMyMessagesClient,
  createMyNotesClient,
  createMyNotificationsClient,
  createMyProfileClient,
  createMyReportsClient,
  createMyServicesClient,
  createMySignaturesClient,
  createSigningClient,
  createMyTaxReturnsClient,
  createNotificationsClient,
  createPaymentsSetupClient,
  createPublicAgreementsClient,
  createRequest,
  createRolesClient,
  createSchedulingClient,
  createServicesPricingClient,
  createSettingsClient,
  createSettingsOverviewClient,
  createStaffClient,
  createSupportAccessClient,
  createTasksClient,
  createPayrollClient,
  createTaskWorkClient,
  createTemplatesClient,
  createAutomationsClient,
  createTaxReturnsClient,
  createTaxStatusesClient,
  createTeamClient,
  createUsersClient,
  createWorkspacesClient,
} from '@firmivra/types';
import {
  createAppointmentsMock,
  createAppointmentTypesMock,
  createAvailabilityMock,
  myAppointmentsMock,
} from '../mocks/appointments';
import {
  createAgreementsMock,
  myIntakeAgreementsMock,
  publicAgreementsMock,
} from '../mocks/agreements';
import { createAuditLogMock } from '../mocks/audit-log';
import { beginOnlineMock } from '../mocks/begin-online';
import { createAdminSupportAccessMock, createSupportAccessMock } from '../mocks/support-access';
import { createCalculatorsMock, myCalculatorsMock } from '../mocks/calculators';
import { createClientSignUpsMock } from '../mocks/client-auth';
import { createClientsMock } from '../mocks/clients';
import { createContentMock, myContentMock } from '../mocks/content';
import { createDocumentsMock, myDocumentsMock } from '../mocks/documents';
import {
  createEsignMock,
  createSigningMock,
  MOCK_ESIGN_ROLE,
  mySignaturesMock,
} from '../mocks/esign';
import { createFirmApplicationsMock } from '../mocks/firm-applications';
import { myIntakesMock } from '../mocks/intake';
import { createInvoicesMock, myInvoicesMock } from '../mocks/invoices';
import { createLeadsMock } from '../mocks/leads';
import { createLeadPipelineMock } from '../mocks/leads-pipeline';
import { createIntakeFormsMock } from '../mocks/intake-forms';
import { createServicesPricingMock } from '../mocks/services-pricing';
import { createDashboardMock } from '../mocks/dashboard';
import { createEngagementsMock, myServicesMock } from '../mocks/engagements';
import { createMeMock } from '../mocks/me';
import { myProfileMock } from '../mocks/clients';
import {
  createClientNotesMock,
  createMessagesMock,
  myMessagesMock,
  myNotesMock,
} from '../mocks/messages';
import { createNotificationsMock, myNotificationsMock } from '../mocks/notifications';
import { createPaymentsSetupMock, MOCK_PAYMENTS_STAGE } from '../mocks/payments-setup';
import { createSettingsMock } from '../mocks/settings';
import {
  createBrandingMock,
  createSettingsOverviewMock,
  createUsersMock,
} from '../mocks/settings-admin';
import { createSchedulingMock } from '../mocks/appointments-scheduling';
import { createDepartmentsMock, createRolesMock, createStaffMock } from '../mocks/staff-management';
import { createTasksMock } from '../mocks/tasks';
import { createPayrollMock } from '../mocks/payroll';
import { createTaskWorkMock } from '../mocks/tasks-work';
import { createMyTaxReturnsMock, createTaxReturnsMock } from '../mocks/tax-returns';
import { createTaxStatusesMock } from '../mocks/tax-statuses';
import { sharedTeamMock } from '../mocks/team';
import { createWorkspacesMock, myReportsMock } from '../mocks/workspaces';
import { MOCK_ROLE, mocked, mockedEmpty } from './mock';
import { sessionFetch } from './session';

/**
 * Same origin (/api/v1 on the current host). sessionFetch refreshes the session once on a 401
 * and opens the sign-in page if that fails (lib/session.ts).
 */
const options = { baseUrl: '/api/v1', fetch: sessionFetch };
const request = createRequest(options);
/** False in production builds, where the compiler then drops every mock from the bundle. */
const dev = process.env.NODE_ENV !== 'production';

/**
 * Browser API client. The API's HttpOnly session cookie for this host is sent automatically and
 * never touched by JavaScript. Screens call `api.<module>.<fn>()` through useApiQuery and
 * useApiMutation, never fetch. Each module registers one line here, choosing its mock in mock mode
 * (lib/mock.ts, mocks/<module>.ts):
 *   taxStatuses: dev && mocked('taxStatuses') ? createTaxStatusesMock({ role: MOCK_ROLE }) : createTaxStatusesClient(request),
 * See "Adding a module" in packages/types/README.md.
 */
export const api = {
  ...createApiClient(options),
  // The signed-in user and their firm (`me`, `currentBusiness`), for the layouts in mock mode.
  ...(dev && mocked('me') ? createMeMock() : {}),
  taxStatuses:
    dev && mocked('taxStatuses')
      ? createTaxStatusesMock({ role: MOCK_ROLE })
      : createTaxStatusesClient(request),
  /** The firm's team: roles, deactivate, resend invites (docs/api/team.yaml). Invites: staffAuth. */
  team: dev && mocked('team') ? sharedTeamMock(MOCK_ROLE) : createTeamClient(request),
  /** Staff Management (R42 contract): directory, Create/Edit Staff, security, documents, import. */
  staff:
    dev && mocked('staff')
      ? createStaffMock({ role: MOCK_ROLE, empty: mockedEmpty('staff') })
      : createStaffClient(request, options.baseUrl),
  /** Teams & Departments and the org chart (R42 contract). Mock shares api.staff's rows. */
  departments:
    dev && mocked('departments')
      ? createDepartmentsMock({ role: MOCK_ROLE, empty: mockedEmpty('departments') })
      : createDepartmentsClient(request),
  /** Roles and the permission grid (R42 contract): Create Staff step 2, Settings > Users & Roles. */
  roles:
    dev && mocked('roles')
      ? createRolesMock({ role: MOCK_ROLE, empty: mockedEmpty('roles') })
      : createRolesClient(request),
  /** Settings > Overview (R42 contract). */
  settingsOverview:
    dev && mocked('settingsOverview')
      ? createSettingsOverviewMock({ role: MOCK_ROLE, empty: mockedEmpty('settingsOverview') })
      : createSettingsOverviewClient(request),
  /** Settings > Company Profile & Branding beyond api.settings (R42 contract). */
  branding:
    dev && mocked('branding')
      ? createBrandingMock({ role: MOCK_ROLE, empty: mockedEmpty('branding') })
      : createBrandingClient(request),
  /** Settings > Users & Roles: the user table, KPIs, export, Invite User (R42 contract). */
  users:
    dev && mocked('users')
      ? createUsersMock({ role: MOCK_ROLE, empty: mockedEmpty('users') })
      : createUsersClient(request, options.baseUrl),
  /** Settings, the setup wizard, and the firm's Terms and Privacy (docs/api/settings.yaml). */
  settings:
    dev && mocked('settings')
      ? createSettingsMock({ role: MOCK_ROLE })
      : createSettingsClient(request),
  /** Pending client sign-ups, approve and decline (docs/api/client-auth.yaml). */
  clientSignUps:
    dev && mocked('clientSignUps')
      ? createClientSignUpsMock({ role: MOCK_ROLE })
      : createClientSignUpsClient(request),
  /** Client records (R10): firm side. */
  // R34: wired to its existing mock (mocks/clients.ts), which no module had registered yet.
  clients:
    dev && mocked('clients')
      ? createClientsMock({ role: MOCK_ROLE })
      : createClientsClient(request),
  engagements:
    dev && mocked('engagements')
      ? createEngagementsMock({ role: MOCK_ROLE })
      : createEngagementsClient(request),
  /** Tax returns per client and year (R10): firm side. */
  taxReturns:
    dev && mocked('taxReturns')
      ? createTaxReturnsMock({ role: MOCK_ROLE })
      : createTaxReturnsClient(request),
  /** Begin Online leads (R11): the firm's inbox, convert and decline. */
  leads: dev && mocked('leads') ? createLeadsMock({ role: MOCK_ROLE }) : createLeadsClient(request),
  /** Leads page and Lead Profile (R43 contract): pipeline, follow-ups, activity, convert to client. */
  leadPipeline:
    dev && mocked('leadPipeline')
      ? createLeadPipelineMock({ role: MOCK_ROLE, empty: mockedEmpty('leadPipeline') })
      : createLeadPipelineClient(request),
  /** Intake Forms workspace (R43 contract): dashboard, builder, send, review, templates, settings. */
  intakeForms:
    dev && mocked('intakeForms')
      ? createIntakeFormsMock({ role: MOCK_ROLE, empty: mockedEmpty('intakeForms') })
      : createIntakeFormsClient(request),
  /** Services & Pricing (R43 contract): services, categories, packages, promotions. */
  servicesPricing:
    dev && mocked('servicesPricing')
      ? createServicesPricingMock({ role: MOCK_ROLE, empty: mockedEmpty('servicesPricing') })
      : createServicesPricingClient(request),
  /** The firm dashboard's numbers (R30). */
  dashboard: dev && mocked('dashboard') ? createDashboardMock() : createDashboardClient(request),
  /** Client records (R10): the signed-in client's own, per firm (portal). */
  myProfile: (firmSlug: string) =>
    dev && mocked('myProfile') ? myProfileMock(firmSlug) : createMyProfileClient(request, firmSlug),
  myServices: (firmSlug: string) =>
    dev && mocked('myServices')
      ? myServicesMock(firmSlug)
      : createMyServicesClient(request, firmSlug),
  myTaxReturns: (firmSlug: string) =>
    dev && mocked('myTaxReturns')
      ? createMyTaxReturnsMock()
      : createMyTaxReturnsClient(request, firmSlug),
  /** Appointments (R12): types, working hours and blocked time, and the firm's calendar. */
  appointmentTypes:
    dev && mocked('appointmentTypes')
      ? createAppointmentTypesMock({ role: MOCK_ROLE })
      : createAppointmentTypesClient(request),
  availability:
    dev && mocked('availability')
      ? createAvailabilityMock({ role: MOCK_ROLE })
      : createAvailabilityClient(request),
  appointments:
    dev && mocked('appointments')
      ? createAppointmentsMock({ role: MOCK_ROLE })
      : createAppointmentsClient(request),
  /** Appointments workspace (R42 contract): KPIs, agenda views, the full scheduling form, availability panel. */
  scheduling:
    dev && mocked('scheduling')
      ? createSchedulingMock({ role: MOCK_ROLE, empty: mockedEmpty('scheduling') })
      : createSchedulingClient(request),
  /** Appointments (R12): the signed-in client's own, per firm (portal). */
  myAppointments: (firmSlug: string) =>
    dev && mocked('myAppointments')
      ? myAppointmentsMock(firmSlug)
      : createMyAppointmentsClient(request, firmSlug),
  /** Content (R12): resources, tips and external links; the portal reads published ones. */
  content:
    dev && mocked('content')
      ? createContentMock({ role: MOCK_ROLE })
      : createContentClient(request),
  myContent: (firmSlug: string) =>
    dev && mocked('myContent') ? myContentMock(firmSlug) : createMyContentClient(request, firmSlug),
  /** Calculators (R12): the firm's settings, and the portal's enabled calculators. */
  calculators:
    dev && mocked('calculators')
      ? createCalculatorsMock({ role: MOCK_ROLE })
      : createCalculatorsClient(request),
  myCalculators: (firmSlug: string) =>
    dev && mocked('myCalculators')
      ? myCalculatorsMock(firmSlug)
      : createMyCalculatorsClient(request, firmSlug),
  /** Calculators (R14): the firm's enabled calculators for the public pages, no sign-in. */
  publicCalculators: (firmSlug: string) =>
    dev && mocked('myCalculators')
      ? myCalculatorsMock(firmSlug)
      : createPublicCalculatorsClient(request, firmSlug),
  /** Documents (R5): a client's files and document requests, for the firm. Upload with uploadFile(). */
  documents:
    dev && mocked('documents')
      ? createDocumentsMock({ role: MOCK_ROLE })
      : createDocumentsClient(request),
  /** Documents (R5): the signed-in client's own files and requests, per firm (portal). */
  myDocuments: (firmSlug: string) =>
    dev && mocked('myDocuments')
      ? myDocumentsMock(firmSlug)
      : createMyDocumentsClient(request, firmSlug),
  /** Tasks (R12): the firm's to-dos for its clients (client record Tasks tab, workspaces). */
  tasks: dev && mocked('tasks') ? createTasksMock({ role: MOCK_ROLE }) : createTasksClient(request),
  /**
   * Payroll (R39): payroll clients, workers, runs, filings and reports. Mock:
   * NEXT_PUBLIC_API_MOCK=payroll (mocks/payroll.ts, R56).
   */
  payroll:
    dev && mocked('payroll')
      ? createPayrollMock({ role: MOCK_ROLE, empty: mockedEmpty('payroll') })
      : createPayrollClient(request),
  /**
   * Tasks module (R55): overview, create/edit, checklist, templates and recurring series. Mock:
   * NEXT_PUBLIC_API_MOCK=taskWork (mocks/tasks-work.ts, R56).
   */
  taskWork:
    dev && mocked('taskWork')
      ? createTaskWorkMock({ role: MOCK_ROLE, empty: mockedEmpty('taskWork') })
      : createTaskWorkClient(request),
  /**
   * Templates (R55): the library, categories, merge fields, branding, import and the starter
   * templates. Real API only until its mock is written.
   */
  templates: createTemplatesClient(request),
  /**
   * Automations (R55): overview, rules and their versions, rule templates, logs and settings.
   * Real API only until its mock is written.
   */
  automations: createAutomationsClient(request),
  /** Workspaces (R12): Bookkeeping and Tax Planning, with their reports. */
  workspaces:
    dev && mocked('workspaces')
      ? createWorkspacesMock({ role: MOCK_ROLE })
      : createWorkspacesClient(request),
  /** Workspaces (R12): a client's published reports in My Services, per firm (portal). */
  myReports: (firmSlug: string) =>
    dev && mocked('myReports') ? myReportsMock(firmSlug) : createMyReportsClient(request, firmSlug),
  /** Intake agreements (R14): the firm's versioned agreements and their PDF originals. */
  agreements:
    dev && mocked('agreements')
      ? createAgreementsMock({ role: MOCK_ROLE })
      : createAgreementsClient(request),
  /** Intake agreements (R14): what a Begin Online visitor signs before the form submits (public). */
  publicAgreements: (firmSlug: string) =>
    dev && mocked('publicAgreements')
      ? publicAgreementsMock(firmSlug)
      : createPublicAgreementsClient(request, firmSlug),
  /** Intake agreements (R14): what the signed-in client signs for one of their portal intakes. */
  myIntakeAgreements: (firmSlug: string) =>
    dev && mocked('myIntakeAgreements')
      ? myIntakeAgreementsMock(firmSlug)
      : createMyIntakeAgreementsClient(request, firmSlug),
  /** Audit log viewer (R12): the firm's own log, for the Owner and Admins. */
  auditLog:
    dev && mocked('auditLog')
      ? createAuditLogMock({ role: MOCK_ROLE })
      : createAuditLogClient(request),
  /** Support access (R8): Firmivra Support's requests to the firm; Owner and Admin read, an Owner decides. */
  supportAccess:
    dev && mocked('supportAccess')
      ? createSupportAccessMock({ role: MOCK_ROLE })
      : createSupportAccessClient(request),
  /** Support access (R8): a Super Admin's requests to firms (admin site). */
  adminSupportAccess:
    dev && mocked('adminSupportAccess')
      ? createAdminSupportAccessMock()
      : createAdminSupportAccessClient(request),
  /** Notifications (R6): the signed-in member's bell and preferences (docs/api/notifications.yaml). */
  notifications:
    dev && mocked('notifications') ? createNotificationsMock() : createNotificationsClient(request),
  /** Notifications (R6): the signed-in client's own, per firm (portal). Same calls as `notifications`. */
  myNotifications: (firmSlug: string) =>
    dev && mocked('myNotifications')
      ? myNotificationsMock(firmSlug)
      : createMyNotificationsClient(request, firmSlug),
  /** Firm applications (R4): the public apply form, and the Super Admin's applications, firms and dashboard. */
  firmApplications:
    dev && mocked('firmApplications')
      ? createFirmApplicationsMock()
      : createFirmApplicationsClient(request),
  /** Invoices (R7): the firm's invoices with lines; create, send, cancel (docs/api/invoices.yaml). */
  invoices:
    dev && mocked('invoices')
      ? createInvoicesMock({ role: MOCK_ROLE })
      : createInvoicesClient(request),
  /** Invoices (R7): the signed-in client's invoices and Pay Now (Stripe checkout), per firm (portal). */
  myInvoices: (firmSlug: string) =>
    dev && mocked('myInvoices')
      ? myInvoicesMock(firmSlug)
      : createMyInvoicesClient(request, firmSlug),
  /** Payments (R7): Settings > Payments, the firm's Stripe Connect onboarding (docs/api/invoices.yaml). */
  paymentsSetup:
    dev && mocked('paymentsSetup')
      ? createPaymentsSetupMock({ role: MOCK_ROLE, stage: MOCK_PAYMENTS_STAGE })
      : createPaymentsSetupClient(request),
  /** Firm Sign (R13): signature requests for the firm; `status()` for the menu (docs/api/esign.yaml). */
  esign:
    dev && mocked('esign')
      ? createEsignMock({ role: MOCK_ESIGN_ROLE ?? MOCK_ROLE })
      : createEsignClient(request, options.baseUrl),
  /** Firm Sign (R13): the signed-in client's Signature center, per firm (portal). */
  mySignatures: (firmSlug: string) =>
    dev && mocked('mySignatures')
      ? mySignaturesMock(firmSlug)
      : createMySignaturesClient(request, firmSlug),
  /** Begin Online (R11): the public intake on a firm's portal site, without an account. */
  beginOnline: (firmSlug: string) =>
    dev && mocked('beginOnline')
      ? beginOnlineMock(firmSlug)
      : createBeginOnlineClient(request, firmSlug),
  /** Intake forms (R11): the signed-in client's Intake Forms tab, per firm (portal). */
  myIntakes: (firmSlug: string) =>
    dev && mocked('myIntakes') ? myIntakesMock(firmSlug) : createMyIntakesClient(request, firmSlug),
  /** Firm Sign (R13): the signer pages at /{slug}/sign, no account (a link plus a code). */
  signing: (firmSlug: string) =>
    dev && mocked('signing')
      ? createSigningMock(firmSlug)
      : createSigningClient(request, firmSlug, options.baseUrl),
  /** Messages (R20): the firm's threads with its clients; read state and unread counts (docs/api/messages.yaml). */
  messages:
    dev && mocked('messages')
      ? createMessagesMock({ role: MOCK_ROLE })
      : createMessagesClient(request),
  /** Messages (R20): the firm's internal notes on a client. Never shown in the portal. */
  clientNotes:
    dev && mocked('clientNotes')
      ? createClientNotesMock({ role: MOCK_ROLE })
      : createClientNotesClient(request),
  /** Messages (R20): the signed-in client's messages with the firm, per firm (portal). */
  myMessages: (firmSlug: string) =>
    dev && mocked('myMessages')
      ? myMessagesMock(firmSlug)
      : createMyMessagesClient(request, firmSlug),
  /** Messages (R20): the signed-in login's private note and its reminder, per firm (portal). */
  myNotes: (firmSlug: string) =>
    dev && mocked('myNotes') ? myNotesMock(firmSlug) : createMyNotesClient(request, firmSlug),
};
