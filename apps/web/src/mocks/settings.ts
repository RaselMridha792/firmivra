import {
  ApiRequestError,
  FirmSettings,
  FirmSetup,
  LegalDocument,
  LegalKind,
  LegalVersionNumber,
  parseInput,
  PublishLegalDocumentRequest,
  SetupStep,
  type SettingsClient,
  UpdateFirmSettingsRequest,
} from '@firmivra/types';

/**
 * Mock data for `api.settings`. The web kit's mock mode (NEXT_PUBLIC_API_MOCK) swaps the real
 * client for `createSettingsMock()`. Synthetic data only. It checks input with the same schemas
 * and returns the API's error codes, so a screen built on it works unchanged against the API.
 */
const at = '2026-10-06T09:00:00.000Z';

// Parsed, so a fixture that breaks the contract fails as soon as the mock loads.
export const settingsFixture: FirmSettings = FirmSettings.parse({
  business: {
    id: '0199b6a0-0000-7000-8000-0000000000a1',
    slug: 'lvp',
    legalName: null,
    status: 'PENDING_SETUP',
  },
  name: 'LVP Accounting & Taxes',
  contactEmail: 'office@lvp.test',
  contactPhone: '(555) 010-0100',
  website: null,
  addressLine1: '100 Sample Road',
  addressLine2: null,
  city: 'Springfield',
  state: 'GA',
  postalCode: '30000',
  country: 'US',
  timezone: 'America/New_York',
  logoUrl: null,
  primaryColor: null,
  accentColor: null,
  portalName: null,
  portalHeader: null,
  welcomeMessage: null,
  clientSignUpEnabled: true,
  updatedAt: at,
});

const document = (kind: LegalKind, version: number, body: string): LegalDocument =>
  LegalDocument.parse({ kind, version, publishedAt: at, body });

export const legalFixtures: readonly LegalDocument[] = [
  document('terms', 1, '# Terms of Service\n\nSample terms for testing. Not a real agreement.'),
  document('terms', 2, '# Terms of Service\n\nSample terms, version 2. Not a real agreement.'),
  document('privacy', 1, '# Privacy Policy\n\nSample policy for testing. Not a real policy.'),
];

const pause = () => new Promise((resolve) => setTimeout(resolve, 250));
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const STEP_NAMES: Record<SetupStep, string> = {
  branding: 'Branding',
  businessDetails: 'Business details',
  team: 'Team and access',
  clientPortal: 'Client portal',
};

/**
 * An in-memory `api.settings` with the same functions, rules and errors as the API.
 * The firm starts in Pending Setup with no wizard step done; `setupDone: true` starts it Active.
 * `role: 'STAFF'` lets a screen try its no-permission state: every call gets 403 FORBIDDEN.
 */
export function createSettingsMock(
  options: { role?: 'OWNER' | 'ADMIN' | 'STAFF'; setupDone?: boolean } = {},
): SettingsClient {
  // State is replaced, never edited, and callers always get copies, like a real API response.
  let settings: FirmSettings = {
    ...settingsFixture,
    business: {
      ...settingsFixture.business,
      status: options.setupDone ? 'ACTIVE' : 'PENDING_SETUP',
    },
  };
  let setup: FirmSetup = options.setupDone
    ? { completedSteps: [...SetupStep.options], completedAt: at }
    : { completedSteps: [], completedAt: null };
  let documents: LegalDocument[] = legalFixtures.map((doc) => ({ ...doc }));
  const now = () => new Date().toISOString();
  const copySettings = () => ({ ...settings, business: { ...settings.business } });
  const copySetup = () => ({ ...setup, completedSteps: [...setup.completedSteps] });
  const allowed = async () => {
    await pause();
    if (options.role === 'STAFF') throw fail(403, 'FORBIDDEN', 'This action is not permitted');
  };
  const versionsOf = (kind: LegalKind) =>
    documents.filter((doc) => doc.kind === kind).sort((a, b) => b.version - a.version);

  return {
    get: async () => {
      await allowed();
      return copySettings();
    },
    update: async (body) => {
      await allowed();
      const patch = parseInput(UpdateFirmSettingsRequest, body);
      const changes = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      );
      settings = { ...settings, ...changes, updatedAt: now() };
      return copySettings();
    },

    getSetup: async () => {
      await allowed();
      return copySetup();
    },
    completeStep: async (step) => {
      await allowed();
      const done = parseInput(SetupStep, step);
      if (!setup.completedAt && !setup.completedSteps.includes(done)) {
        const steps = new Set([...setup.completedSteps, done]);
        setup = { ...setup, completedSteps: SetupStep.options.filter((s) => steps.has(s)) };
      }
      return copySetup();
    },
    finishSetup: async () => {
      await allowed();
      if (!setup.completedAt) {
        const missing = SetupStep.options.filter((s) => !setup.completedSteps.includes(s));
        if (missing.length > 0) {
          const names = missing.map((s) => STEP_NAMES[s]).join(', ');
          throw fail(409, 'SETUP_INCOMPLETE', `Finish these steps first: ${names}`);
        }
        setup = { ...setup, completedAt: now() };
        settings = { ...settings, business: { ...settings.business, status: 'ACTIVE' } };
      }
      return copySetup();
    },

    getLegal: async (kind) => {
      await allowed();
      const versions = versionsOf(parseInput(LegalKind, kind));
      const current = versions[0];
      return {
        current: current ? { ...current } : null,
        versions: versions.map(({ version, publishedAt }) => ({ version, publishedAt })),
      };
    },
    getLegalVersion: async (kind, version) => {
      await allowed();
      const wanted = parseInput(LegalVersionNumber, version);
      const doc = versionsOf(parseInput(LegalKind, kind)).find((d) => d.version === wanted);
      if (!doc) throw fail(404, 'NOT_FOUND', 'Not found');
      return { ...doc };
    },
    publishLegal: async (kind, body) => {
      await allowed();
      const which = parseInput(LegalKind, kind);
      const { body: text } = parseInput(PublishLegalDocumentRequest, body);
      const version = (versionsOf(which)[0]?.version ?? 0) + 1;
      const doc: LegalDocument = { kind: which, version, publishedAt: now(), body: text };
      documents = [...documents, doc];
      return { ...doc };
    },
  };
}
