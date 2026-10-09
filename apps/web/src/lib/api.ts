import {
  createAdminSupportAccessClient,
  createApiClient,
  createAppointmentsClient,
  createAppointmentTypesClient,
  createAuditLogClient,
  createAvailabilityClient,
  createCalculatorsClient,
  createClientNotesClient,
  createClientsClient,
  createClientSignUpsClient,
  createContentClient,
  createDocumentsClient,
  createEngagementsClient,
  createEsignClient,
  createFirmApplicationsClient,
  createInvoicesClient,
  createLeadsClient,
  createMessagesClient,
  createMyAppointmentsClient,
  createMyCalculatorsClient,
  createMyContentClient,
  createMyDocumentsClient,
  createMyInvoicesClient,
  createMyMessagesClient,
  createMyNotesClient,
  createMyNotificationsClient,
  createMyProfileClient,
  createMyReportsClient,
  createMyServicesClient,
  createMySignaturesClient,
  createMyTaxReturnsClient,
  createNotificationsClient,
  createRequest,
  createSettingsClient,
  createSupportAccessClient,
  createTasksClient,
  createTaxReturnsClient,
  createTaxStatusesClient,
  createTeamClient,
  createWorkspacesClient,
} from '@firmivra/types';
import {
  createAppointmentsMock,
  createAppointmentTypesMock,
  createAvailabilityMock,
  myAppointmentsMock,
} from '../mocks/appointments';
import { createAuditLogMock } from '../mocks/audit-log';
import { createAdminSupportAccessMock, createSupportAccessMock } from '../mocks/support-access';
import { createCalculatorsMock, myCalculatorsMock } from '../mocks/calculators';
import { createClientSignUpsMock } from '../mocks/client-auth';
import { createContentMock, myContentMock } from '../mocks/content';
import { createDocumentsMock, myDocumentsMock } from '../mocks/documents';
import { createEsignMock, mySignaturesMock } from '../mocks/esign';
import { createFirmApplicationsMock } from '../mocks/firm-applications';
import { createInvoicesMock, myInvoicesMock } from '../mocks/invoices';
import { createLeadsMock } from '../mocks/leads';
import { createEngagementsMock, myServicesMock } from '../mocks/engagements';
import { createMeMock } from '../mocks/me';
import {
  createClientNotesMock,
  createMessagesMock,
  myMessagesMock,
  myNotesMock,
} from '../mocks/messages';
import { createNotificationsMock, myNotificationsMock } from '../mocks/notifications';
import { createSettingsMock } from '../mocks/settings';
import { createTasksMock } from '../mocks/tasks';
import { createMyTaxReturnsMock, createTaxReturnsMock } from '../mocks/tax-returns';
import { createTaxStatusesMock } from '../mocks/tax-statuses';
import { sharedTeamMock } from '../mocks/team';
import { createWorkspacesMock, myReportsMock } from '../mocks/workspaces';
import { MOCK_ROLE, mocked } from './mock';
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
  clients: createClientsClient(request),
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
  /** Client records (R10): the signed-in client's own, per firm (portal). */
  myProfile: (firmSlug: string) => createMyProfileClient(request, firmSlug),
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
  /** Workspaces (R12): Bookkeeping and Tax Planning, with their reports. */
  workspaces:
    dev && mocked('workspaces')
      ? createWorkspacesMock({ role: MOCK_ROLE })
      : createWorkspacesClient(request),
  /** Workspaces (R12): a client's published reports in My Services, per firm (portal). */
  myReports: (firmSlug: string) =>
    dev && mocked('myReports') ? myReportsMock(firmSlug) : createMyReportsClient(request, firmSlug),
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
  /** Firm Sign (R13): signature requests for the firm; `status()` for the menu (docs/api/esign.yaml). */
  esign:
    dev && mocked('esign')
      ? createEsignMock({ role: MOCK_ROLE })
      : createEsignClient(request, options.baseUrl),
  /** Firm Sign (R13): the signed-in client's Signature center, per firm (portal). */
  mySignatures: (firmSlug: string) =>
    dev && mocked('mySignatures')
      ? mySignaturesMock(firmSlug)
      : createMySignaturesClient(request, firmSlug),
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
