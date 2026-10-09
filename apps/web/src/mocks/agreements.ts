import {
  type AgreementFile,
  AgreementPathId,
  type AgreementsClient,
  AgreementVersion,
  AgreementVersionNumber,
  ApiRequestError,
  ConfirmUploadRequest,
  CreateAgreementRequest,
  CreateAgreementUploadRequest,
  FirmAgreementSummary,
  INTAKE_FORMS,
  type IntakeAgreement,
  IntakeAgreementBlock,
  IntakeAgreementsQuery,
  type IntakeFormKey,
  MAX_SERVICE_AGREEMENTS,
  type MyIntakeAgreementsClient,
  parseInput,
  type PublicAgreementsClient,
  PublishAgreementVersionRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import type { MockFirmRole } from './clients';

/**
 * Mock data for `api.agreements` (firm), `api.publicAgreements(slug)` (Begin Online) and
 * `api.myIntakeAgreements(slug)` (the portal intake), R14. Synthetic text only: never a firm's
 * real agreement. Same input checks, rules and error codes as the API; the fixtures are parsed
 * with the response schemas, so they cannot drift from the contract. A mock upload needs no
 * storage (its URL starts with `mock:`). The seeded versions' PDFs are CLEAN files, so a new
 * version can reuse one. To show the PDF states on a screen, upload a file whose name contains:
 *   "pending"  the scan never finishes (publish answers 409 FILE_NOT_READY)
 *   "password" confirm answers 409 FILE_PASSWORD_PROTECTED
 *   "notpdf"   confirm answers 409 NOT_A_PDF
 *   "pages"    confirm answers 409 TOO_MANY_PAGES
 *   "mismatch" confirm answers 409 UPLOAD_MISMATCH
 *   "virus"    the scan comes back INFECTED (publish answers 409 FILE_BLOCKED)
 * Any other file is PENDING for a few seconds, then CLEAN. A service takes at most
 * MAX_SERVICE_AGREEMENTS unarchived agreements (409 SERVICE_AGREEMENT_LIMIT).
 * The block: slug `not-ready` has no firm-wide agreement yet (ready: false); any other slug gets
 * the sample firm-wide agreement, plus the Bookkeeping one for the BOOKKEEPING form. A form
 * INTAKE_FORMS doesn't have answers 404, as in the intake mocks. The block is seeded on its own:
 * versions published with the firm mock (`api.agreements`) never show in it.
 * The portal block knows the intake mock's six intakes (mocks/intake.ts, R11's contract B: ids
 * 0199b6a8-...-1 to -6 with their forms); any other intake id answers 404.
 */
const at = '2026-10-06T09:00:00.000Z';
const SCAN_MS = 3000;
const owner = { userId: '0199b6a0-0000-7000-8000-0000000000a2', name: 'Olivia Owner' };
const uuid = (group: string, n: number) =>
  `0199b6a5-${group}-7000-8000-${String(n).padStart(12, '0')}`;
/** The sample service with its own extra agreement. */
export const SAMPLE_SERVICE_ID = '0199b6a3-0000-7000-8000-000000000001';
const SAMPLE_SERVICE = { id: SAMPLE_SERVICE_ID, name: 'Bookkeeping' };
const hex = (n: number) => n.toString(16).padStart(64, '0');

const firmWideText = `# Client Intake Agreement (sample)

**Not legal text.** A synthetic agreement for building and testing screens.

## 1. Services

The firm prepares the returns and reports named in your intake form.

## 2. Your information

| You give us | We use it for |
| --- | --- |
| Income documents | Preparing your return |
| Contact details | Reaching you about your file |

Questions? Write to [the office](mailto:office@sample.test).`;

const acknowledgments = [
  {
    key: 'read_agreement',
    label: 'I have read the agreement',
    text: 'I have read and understood this agreement.',
    required: true,
  },
  {
    key: 'accurate_information',
    label: 'My information is accurate',
    text: 'The information I give the firm is true and complete to the best of my knowledge.',
    required: true,
  },
  {
    key: 'marketing_tips',
    label: 'Send me tax tips',
    text: 'The firm may email me occasional tax tips. I can stop them at any time.',
    required: false,
  },
];

interface Series {
  summary: FirmAgreementSummary;
  versions: AgreementVersion[];
}

const pdf = (n: number, fileName: string) => ({
  fileId: uuid('0002', n),
  fileName,
  sizeBytes: 48_213,
  sha256: hex(n),
});
/** The seeded versions' PDF originals (CLEAN). */
const seededFiles = (series: Series[]): AgreementFile[] =>
  series.flatMap((s) =>
    s.versions.flatMap((v) => (v.pdf ? [{ ...v.pdf, scanStatus: 'CLEAN' as const }] : [])),
  );

function seed(): Series[] {
  const firmWide = uuid('0001', 1);
  const service = uuid('0001', 2);
  const version = (
    agreementId: string,
    n: number,
    title: string,
    body: string,
    acks: typeof acknowledgments,
  ): AgreementVersion =>
    AgreementVersion.parse({
      agreementId,
      version: n,
      title,
      effectiveDate: '2026-10-01',
      publishedAt: at,
      publishedBy: owner,
      pdf: pdf(n + (agreementId === firmWide ? 0 : 10), `${title.replace(/\W+/g, '-')}.pdf`),
      bodyMarkdown: body,
      bodySha256: hex(1000 + n + (agreementId === firmWide ? 0 : 10)),
      acknowledgments: acks,
    });
  const fw = [
    version(
      firmWide,
      1,
      'Client Intake Agreement (sample)',
      firmWideText,
      acknowledgments.slice(0, 1),
    ),
    version(firmWide, 2, 'Client Intake Agreement (sample)', firmWideText, acknowledgments),
  ].reverse();
  const sv = [
    version(
      service,
      1,
      'Bookkeeping Terms (sample)',
      '# Bookkeeping Terms (sample)\n\n**Not legal text.** Monthly books close on the 15th.',
      [
        {
          key: 'monthly_close',
          label: 'Monthly close',
          text: 'I will send each month’s statements by the 10th.',
          required: true,
        },
      ],
    ),
  ];
  const summary = (
    id: string,
    scope: FirmAgreementSummary['scope'],
    versions: AgreementVersion[],
    sortOrder: number,
  ): FirmAgreementSummary =>
    FirmAgreementSummary.parse({
      id,
      scope,
      service: scope === 'SERVICE' ? SAMPLE_SERVICE : null,
      sortOrder,
      archivedAt: null,
      current: listed(versions[0]),
      versionCount: versions.length,
    });
  return [
    { summary: summary(firmWide, 'ALL_INTAKES', fw, 0), versions: fw },
    { summary: summary(service, 'SERVICE', sv, 0), versions: sv },
  ];
}

const listed = (v: AgreementVersion | undefined) =>
  v
    ? {
        version: v.version,
        title: v.title,
        effectiveDate: v.effectiveDate,
        publishedAt: v.publishedAt,
        publishedBy: v.publishedBy,
        pdf: v.pdf,
      }
    : null;
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const notFound = () => fail(404, 'NOT_FOUND', 'Not found');
const uuidInput = (value: string) => parseInput(AgreementPathId, value);
const link = () => ({
  url: 'mock:download/agreement.pdf',
  expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
});

/**
 * An in-memory `api.agreements`. `role: 'STAFF'` gets 403 FORBIDDEN on every call, as in the API.
 * `pdfRequired: false` lets a version publish without a PDF (AGREEMENT_PDF_REQUIRED off).
 */
export function createAgreementsMock(
  options: { role?: MockFirmRole; pdfRequired?: boolean } = {},
): AgreementsClient {
  let series = seed();
  let next = 100;
  const files = new Map<string, AgreementFile & { readyAt: number; finalScan: string }>(
    seededFiles(series).map((f) => [f.fileId, { ...f, readyAt: 0, finalScan: 'CLEAN' }]),
  );
  const pending = new Map<string, { fileName: string; sizeBytes: number; sha256: string }>();
  const allowed = async () => {
    await mockDelay();
    if (options.role === 'STAFF') throw fail(403, 'FORBIDDEN', 'This action is not permitted');
  };
  const find = (id: string) => {
    uuidInput(id);
    const s = series.find((x) => x.summary.id === id);
    if (!s) throw notFound();
    return s;
  };
  const fileView = (id: string): AgreementFile => {
    const f = files.get(uuidInput(id));
    if (!f) throw notFound();
    const { readyAt, finalScan, ...file } = f;
    const scanStatus =
      file.scanStatus === 'PENDING' && readyAt <= Date.now() ? finalScan : file.scanStatus;
    return { ...file, scanStatus: scanStatus as AgreementFile['scanStatus'] };
  };
  // `series` is in creation order, and sort is stable: the API's createdAt tie-break.
  const ordered = () =>
    [...series].sort(
      (a, b) =>
        Number(a.summary.scope === 'SERVICE') - Number(b.summary.scope === 'SERVICE') ||
        a.summary.sortOrder - b.summary.sortOrder,
    );

  return {
    list: async () => {
      await allowed();
      return structuredClone({
        items: ordered().map((s) => s.summary),
        services: [{ ...SAMPLE_SERVICE, kind: 'BOOKKEEPING' as const }],
      });
    },
    create: async (body) => {
      await allowed();
      const input = parseInput(CreateAgreementRequest, body);
      const firmWideOpen = series.some(
        (s) => s.summary.scope === 'ALL_INTAKES' && !s.summary.archivedAt,
      );
      if (input.scope === 'ALL_INTAKES' && firmWideOpen) {
        throw fail(409, 'FIRM_WIDE_EXISTS', 'The firm already has a firm-wide agreement');
      }
      if (input.scope === 'SERVICE' && input.serviceId !== SAMPLE_SERVICE_ID) throw notFound();
      const open = series.filter(
        (s) => s.summary.service?.id === input.serviceId && !s.summary.archivedAt,
      );
      if (input.scope === 'SERVICE' && open.length >= MAX_SERVICE_AGREEMENTS) {
        throw fail(409, 'SERVICE_AGREEMENT_LIMIT', 'This service already has 9 agreements');
      }
      const summary: FirmAgreementSummary = {
        id: uuid('0001', next++),
        scope: input.scope,
        service: input.scope === 'SERVICE' ? SAMPLE_SERVICE : null,
        sortOrder: 0,
        archivedAt: null,
        current: null,
        versionCount: 0,
      };
      series = [...series, { summary, versions: [] }];
      return structuredClone(summary);
    },
    get: async (agreementId) => {
      await allowed();
      const s = find(agreementId);
      return structuredClone({ ...s.summary, versions: s.versions.map((v) => listed(v)!) });
    },
    getVersion: async (agreementId, version) => {
      await allowed();
      const wanted = parseInput(AgreementVersionNumber, version);
      const v = find(agreementId).versions.find((x) => x.version === wanted);
      if (!v) throw notFound();
      return structuredClone(v);
    },
    publish: async (agreementId, body) => {
      await allowed();
      const input = parseInput(PublishAgreementVersionRequest, body);
      const s = find(agreementId);
      if (s.summary.archivedAt) throw fail(409, 'AGREEMENT_ARCHIVED', 'This agreement is archived');
      const current = s.versions[0]?.version ?? null;
      if (input.expectedCurrentVersion !== current) {
        throw fail(409, 'VERSION_CONFLICT', 'Someone published a newer version');
      }
      if (s.summary.scope === 'ALL_INTAKES' && !input.acknowledgments.some((a) => a.required)) {
        throw fail(400, 'VALIDATION_FAILED', 'The firm-wide agreement needs a required box');
      }
      let file: AgreementFile | null = null;
      if (input.pdfFileId) {
        file = fileView(input.pdfFileId);
        if (file.scanStatus === 'PENDING') throw fail(409, 'FILE_NOT_READY', 'Still checking');
        if (file.scanStatus !== 'CLEAN') throw fail(409, 'FILE_BLOCKED', 'File blocked');
      } else if (options.pdfRequired !== false) {
        throw fail(409, 'PDF_REQUIRED', 'Upload the PDF original first');
      }
      const v: AgreementVersion = {
        agreementId,
        version: (current ?? 0) + 1,
        title: input.title,
        effectiveDate: input.effectiveDate ?? null,
        publishedAt: new Date().toISOString(),
        publishedBy: owner,
        pdf: file
          ? {
              fileId: file.fileId,
              fileName: file.fileName,
              sizeBytes: file.sizeBytes,
              sha256: file.sha256,
            }
          : null,
        bodyMarkdown: input.bodyMarkdown,
        bodySha256: hex(next++),
        acknowledgments: input.acknowledgments,
      };
      const versions = [v, ...s.versions];
      const summary = { ...s.summary, current: listed(v), versionCount: versions.length };
      series = series.map((x) => (x === s ? { summary, versions } : x));
      return structuredClone(v);
    },
    archive: async (agreementId) => {
      await allowed();
      const s = find(agreementId);
      if (s.summary.scope === 'ALL_INTAKES') {
        throw fail(409, 'FIRM_WIDE_REQUIRED', 'The firm-wide agreement can’t be archived');
      }
      const summary = {
        ...s.summary,
        archivedAt: s.summary.archivedAt ?? new Date().toISOString(),
      };
      series = series.map((x) => (x === s ? { ...x, summary } : x));
      return structuredClone(summary);
    },

    createUpload: async (body) => {
      await allowed();
      const input = parseInput(CreateAgreementUploadRequest, body);
      const token = `mock-agreement-upload-${next++}`;
      pending.set(token, input);
      return {
        uploadToken: token,
        url: `mock:upload/${token}`,
        method: 'PUT',
        headers: { 'content-type': 'application/pdf' },
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      };
    },
    confirmUpload: async (body) => {
      await allowed();
      const { uploadToken } = parseInput(ConfirmUploadRequest, body);
      const p = pending.get(uploadToken);
      if (!p) throw fail(410, 'UPLOAD_EXPIRED', 'This upload has expired');
      pending.delete(uploadToken);
      const name = p.fileName.toLowerCase();
      if (name.includes('password')) {
        throw fail(409, 'FILE_PASSWORD_PROTECTED', 'This PDF has a password');
      }
      if (name.includes('notpdf')) throw fail(409, 'NOT_A_PDF', 'This file isn’t a PDF');
      if (name.includes('pages')) throw fail(409, 'TOO_MANY_PAGES', 'More than 200 pages');
      if (name.includes('mismatch')) throw fail(409, 'UPLOAD_MISMATCH', 'This file changed');
      const fileId = uuid('0002', next++);
      files.set(fileId, {
        fileId,
        fileName: p.fileName,
        sizeBytes: p.sizeBytes,
        sha256: p.sha256,
        scanStatus: 'PENDING',
        readyAt: name.includes('pending') ? Infinity : Date.now() + SCAN_MS,
        finalScan: name.includes('virus') ? 'INFECTED' : 'CLEAN',
      });
      return fileView(fileId);
    },
    file: async (fileId) => {
      await allowed();
      return fileView(fileId);
    },
    download: async (fileId) => {
      await allowed();
      const scan = fileView(fileId).scanStatus;
      if (scan === 'PENDING') throw fail(409, 'SCAN_PENDING', 'The file is still being checked');
      if (scan !== 'CLEAN') throw fail(409, 'FILE_BLOCKED', 'File blocked');
      return link();
    },
  };
}

/**
 * The block for a form: the sample firm-wide agreement, plus the Bookkeeping one for BOOKKEEPING.
 * `legal` is set only on Begin Online (both Terms and Privacy published).
 */
export function intakeBlockFixture(
  firmSlug: string,
  form: IntakeFormKey,
  where: 'begin' | 'portal' = 'begin',
): IntakeAgreementBlock {
  const legal = where === 'begin' ? { terms: { version: 2 }, privacy: { version: 1 } } : null;
  if (firmSlug.toLowerCase() === 'not-ready') return { ready: false, agreements: [], legal };
  const block = (s: Series): IntakeAgreement => {
    const v = s.versions[0]!;
    return {
      agreementId: s.summary.id,
      scope: s.summary.scope,
      version: v.version,
      title: v.title,
      effectiveDate: v.effectiveDate,
      publishedAt: v.publishedAt,
      bodyMarkdown: v.bodyMarkdown,
      bodySha256: v.bodySha256,
      acknowledgments: v.acknowledgments,
      pdf: {
        available: v.pdf !== null,
        sha256: v.pdf?.sha256 ?? null,
        fileName: v.pdf?.fileName ?? null,
        sizeBytes: v.pdf?.sizeBytes ?? null,
      },
    };
  };
  const [firmWide, service] = seed();
  const agreements = [block(firmWide!)];
  if (form === 'BOOKKEEPING') agreements.push(block(service!));
  return IntakeAgreementBlock.parse({ ready: true, agreements, legal });
}

/** A form the mock firm offers (as mocks/intake.ts): 404 for one INTAKE_FORMS doesn't have. */
const offered = (form: IntakeFormKey) => {
  if (!INTAKE_FORMS[form]) throw notFound();
  return form;
};

/**
 * An in-memory `api.publicAgreements(slug)`. Signing itself goes with R11's submit; its mock
 * (mocks/intake.ts) answers AGREEMENT_OUTDATED when a text answer contains "agreementoutdated".
 */
export function publicAgreementsMock(firmSlug: string): PublicAgreementsClient {
  return {
    block: async (query) => {
      await mockDelay();
      const { form } = parseInput(IntakeAgreementsQuery, query);
      return intakeBlockFixture(firmSlug, offered(form));
    },
    downloadPdf: async (agreementId, version) => {
      await mockDelay();
      uuidInput(agreementId);
      const wanted = parseInput(AgreementVersionNumber, version);
      const found = intakeBlockFixture(firmSlug, 'BOOKKEEPING').agreements.find(
        (a) => a.agreementId === agreementId && a.version === wanted && a.pdf.available,
      );
      if (!found) throw notFound();
      return link();
    },
  };
}

/** The intake mock's intakes (mocks/intake.ts) and their forms. */
const MOCK_INTAKE_FORMS = [
  'ANNUAL_TAX',
  'BOOKKEEPING',
  'ANNUAL_TAX',
  'PAYROLL',
  'QUARTERLY_TAX',
  'TAX_PLANNING',
] as const satisfies readonly IntakeFormKey[];
const intakeForm = (intakeId: string): IntakeFormKey | undefined =>
  MOCK_INTAKE_FORMS.find(
    (_, n) => intakeId === `0199b6a8-0000-7000-8000-${String(n + 1).padStart(12, '0')}`,
  );

/** An in-memory `api.myIntakeAgreements(slug)`: 404 for an intake the client doesn't have. */
export function myIntakeAgreementsMock(firmSlug: string): MyIntakeAgreementsClient {
  return {
    block: async (intakeId) => {
      await mockDelay();
      const form = intakeForm(uuidInput(intakeId));
      if (!form) throw notFound();
      return intakeBlockFixture(firmSlug, form, 'portal');
    },
  };
}
