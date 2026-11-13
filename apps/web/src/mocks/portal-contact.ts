import {
  ApiRequestError,
  parseInput,
  type PortalContactClient,
  PortalContactSwitches,
  type PortalOfficeContact,
  UpdatePortalContactRequest,
} from '@firmivra/types';

// `api.portalContact` in mock mode (PRT-3). Synthetic data only: fake 555 numbers and
// example.test addresses. The switches live for the browser tab's session, so a reload keeps them.

const KEY = 'firmivra-mock:portal-contact';
const DEFAULTS: PortalContactSwitches = {
  showCorporateOffice: true,
  showLocalOffice: true,
  allowPhone: true,
  allowSms: false,
  allowEmail: true,
  allowSecureMessage: true,
  allowAppointmentLink: false,
};
/** The fixtures, built on first use (mocks run nothing on import). */
function fixtures(): { corporate: PortalOfficeContact; offices: PortalOfficeContact[] } {
  const week = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opensAt: '09:00', closesAt: '18:00' }));
  return {
    corporate: {
      id: null,
      name: 'LVP Accounting & Taxes',
      phone: '(770) 555-0134',
      email: 'hello@lvp.example.test',
      addressLines: ['123 Main Street, Suite 100', 'Auburn, GA 30011'],
      hours: week,
    },
    offices: [
      {
        id: '0199d000-0000-7000-8000-000000000001',
        name: 'Auburn Office',
        phone: '+15551234567',
        email: 'auburn@example.test',
        addressLines: ['123 Main St', 'Auburn, GA 30011'],
        hours: week,
      },
      {
        id: '0199d000-0000-7000-8000-000000000002',
        name: 'Lawrenceville Office',
        phone: '+15559876543',
        email: 'lawrenceville@example.test',
        addressLines: ['456 Pine Rd, Suite 200', 'Lawrenceville, GA 30046'],
        hours: week,
      },
    ],
  };
}

let state: { switches: PortalContactSwitches; updatedAt: string | null } | null = null;
function current() {
  if (state) return state;
  try {
    const saved = PortalContactSwitches.safeParse(JSON.parse(sessionStorage.getItem(KEY) ?? ''));
    state = saved.success
      ? { switches: saved.data, updatedAt: new Date().toISOString() }
      : { switches: { ...DEFAULTS }, updatedAt: null };
  } catch {
    state = { switches: { ...DEFAULTS }, updatedAt: null };
  }
  return state;
}
const pause = () => new Promise((r) => setTimeout(r, 120));

/** `role: 'STAFF'` gets the API's 403 on the firm side. The mock client's office is Lawrenceville. */
export function createPortalContactMock(
  options: { role?: 'OWNER' | 'ADMIN' | 'STAFF' } = {},
): PortalContactClient {
  const manage = () => {
    if (options.role === 'STAFF')
      throw new ApiRequestError(403, 'FORBIDDEN', 'This action is not permitted');
  };
  const settings = () => {
    const { corporate, offices } = fixtures();
    return { ...current(), corporate, offices };
  };
  return {
    get: async () => {
      await pause();
      manage();
      return settings();
    },
    update: async (body) => {
      await pause();
      manage();
      const change = parseInput(UpdatePortalContactRequest, body);
      const now = current();
      state = { switches: { ...now.switches, ...change }, updatedAt: new Date().toISOString() };
      try {
        sessionStorage.setItem(KEY, JSON.stringify(state.switches));
      } catch {
        // The visit keeps it.
      }
      return settings();
    },
    mine: async () => {
      await pause();
      const s = current().switches;
      const { corporate, offices } = fixtures();
      return {
        corporate: s.showCorporateOffice ? corporate : null,
        local: s.showLocalOffice ? (offices[1] ?? null) : null,
        methods: {
          phone: s.allowPhone,
          // The mock client opted in to texts.
          sms: s.allowSms,
          email: s.allowEmail,
          secureMessage: s.allowSecureMessage,
          appointment: s.allowAppointmentLink,
        },
      };
    },
  };
}
