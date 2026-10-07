import {
  createApiClient,
  createAppointmentsClient,
  createAppointmentTypesClient,
  createAuditLogClient,
  createAvailabilityClient,
  createCalculatorsClient,
  createClientsClient,
  createClientSignUpsClient,
  createContentClient,
  createDocumentsClient,
  createEngagementsClient,
  createFirmApplicationsClient,
  createMyAppointmentsClient,
  createMyCalculatorsClient,
  createMyContentClient,
  createMyDocumentsClient,
  createMyProfileClient,
  createMyReportsClient,
  createMyServicesClient,
  createMyTaxReturnsClient,
  createRequest,
  createSettingsClient,
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
import { createCalculatorsMock, myCalculatorsMock } from '../mocks/calculators';
import { createClientSignUpsMock } from '../mocks/client-auth';
import { createContentMock, myContentMock } from '../mocks/content';
import { createDocumentsMock, myDocumentsMock } from '../mocks/documents';
import { createFirmApplicationsMock } from '../mocks/firm-applications';
import { createMeMock } from '../mocks/me';
import { createSettingsMock } from '../mocks/settings';
import { createTasksMock } from '../mocks/tasks';
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
  engagements: createEngagementsClient(request),
  taxReturns: createTaxReturnsClient(request),
  /** Client records (R10): the signed-in client's own, per firm (portal). */
  myProfile: (firmSlug: string) => createMyProfileClient(request, firmSlug),
  myServices: (firmSlug: string) => createMyServicesClient(request, firmSlug),
  myTaxReturns: (firmSlug: string) => createMyTaxReturnsClient(request, firmSlug),
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
  /** Firm applications (R4): the public apply form, and the Super Admin's applications, firms and dashboard. */
  firmApplications:
    dev && mocked('firmApplications')
      ? createFirmApplicationsMock()
      : createFirmApplicationsClient(request),
};
