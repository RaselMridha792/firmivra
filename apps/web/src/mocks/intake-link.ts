import {
  ApiRequestError,
  FirmSlug,
  INTAKE_LINK_ERRORS,
  type IntakeLinkClient,
  LinkIntake,
  type MyIntake,
  OpenIntakeLinkRequest,
  parseInput,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { myIntakeAgreementsMock } from './agreements';
import { createMyIntakesMock, intakeFixtures } from './intake';
import { mockBusiness } from './me';

/** The mock's one live link token (43 base64url characters, as the API's). */
export const MOCK_INTAKE_LINK_TOKEN = 'mock-intake-link-token-00000000000000000000';

let linkMocks: Map<string, IntakeLinkClient> | undefined;

/** `api.intakeLink(slug)` on mock data: one per firm slug for the page's lifetime. */
export function intakeLinkMock(firmSlug: string): IntakeLinkClient {
  linkMocks ??= new Map();
  const slug = firmSlug.trim().toLowerCase();
  let mock = linkMocks.get(slug);
  if (!mock) {
    mock = createIntakeLinkMock(firmSlug);
    linkMocks.set(slug, mock);
  }
  return mock;
}

/**
 * An in-memory `api.intakeLink(slug)`: a lead's secure link to the SENT Quarterly Taxes fixture,
 * opened with MOCK_INTAKE_LINK_TOKEN. As the API, any other token (or a read before `open`, which
 * stands for the cookie) is 410 LINK_INVALID, and the form's rules (and its files) are the
 * portal mock's.
 */
export function createIntakeLinkMock(firmSlug: string = mockBusiness.slug): IntakeLinkClient {
  const portal = createMyIntakesMock({}, firmSlug);
  const id = intakeFixtures().find((r) => r.item.status === 'SENT')!.item.id;
  let opened = false;
  const invalid = () => new ApiRequestError(410, 'LINK_INVALID', INTAKE_LINK_ERRORS.LINK_INVALID);
  const live = () => {
    if (parseInput(FirmSlug, firmSlug) !== mockBusiness.slug || !opened) throw invalid();
  };
  const asLink = (i: MyIntake): LinkIntake =>
    LinkIntake.parse({
      id: i.id,
      form: i.form,
      title: i.title,
      firstName: 'Pat',
      status: i.status,
      version: i.version,
      correction: i.correction,
      dueOn: i.dueOn,
      expiresAt: '2026-12-31T23:59:59.999Z',
      definition: i.definition,
      taxYear: i.taxYear,
      answers: i.answers,
      uploads: i.uploads,
      maxFileSizeMb: i.maxFileSizeMb,
      savedSteps: i.savedSteps,
      signature: i.signature,
      canEdit: i.canEdit,
    });

  return {
    open: async (token) => {
      await mockDelay();
      parseInput(OpenIntakeLinkRequest, { token });
      if (parseInput(FirmSlug, firmSlug) !== mockBusiness.slug) throw invalid();
      if (token !== MOCK_INTAKE_LINK_TOKEN) throw invalid();
      opened = true;
      return asLink(await portal.get(id));
    },
    get: async () => {
      await mockDelay();
      live();
      return asLink(await portal.get(id));
    },
    saveStep: async (step, body) => {
      live();
      return portal.saveStep(id, step, body);
    },
    submit: async (body) => {
      live();
      return asLink(await portal.submit(id, body));
    },
    agreements: async () => {
      live();
      return myIntakeAgreementsMock(firmSlug).block(id);
    },
    // Leads item n: the form's upload fields, with the portal mock's steps and rules.
    createUpload: async (body) => {
      live();
      return portal.createUpload(id, body);
    },
    confirmUpload: async (body) => {
      live();
      return portal.confirmUpload(id, body);
    },
    removeUpload: async (uploadId) => {
      live();
      return portal.removeUpload(id, uploadId);
    },
  };
}
