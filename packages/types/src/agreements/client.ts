import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { ConfirmUploadRequest, UploadTicket } from '../documents/schemas.js';
import {
  AgreementFile,
  AgreementVersion,
  AgreementVersionNumber,
  CreateAgreementRequest,
  CreateAgreementUploadRequest,
  DownloadLink,
  FirmAgreementDetail,
  FirmAgreementList,
  FirmAgreementSummary,
  IntakeAgreementBlock,
  IntakeAgreementsQuery,
  PublishAgreementVersionRequest,
} from './schemas.js';
import { z } from 'zod';

const AGREEMENTS = '/business/agreements';
const FILES = `${AGREEMENTS}/files`;
const id = (value: string) => parseInput(z.uuid(), value);
const series = (agreementId: string) => `${AGREEMENTS}/${id(agreementId)}`;

/**
 * `api.agreements` (apps/web/src/lib/api.ts): the firm's intake agreements in Settings > Terms
 * & Privacy (docs/api/agreements.yaml). Owner and Admin only (403 for staff); works while the
 * firm is Pending Setup. Bad input rejects with ApiRequestError(400, 'VALIDATION_FAILED') before
 * anything is sent. Upload a PDF with uploadFile() using createUpload and confirmUpload below.
 */
export function createAgreementsClient(request: ApiRequest) {
  return {
    list: async (): Promise<FirmAgreementList> => request(FirmAgreementList, AGREEMENTS),
    /** 409 FIRM_WIDE_EXISTS; 404 for another firm's or an archived service. */
    create: async (body: CreateAgreementRequest): Promise<FirmAgreementSummary> =>
      request(FirmAgreementSummary, AGREEMENTS, {
        method: 'POST',
        body: parseInput(CreateAgreementRequest, body),
      }),
    get: async (agreementId: string): Promise<FirmAgreementDetail> =>
      request(FirmAgreementDetail, series(agreementId)),
    getVersion: async (agreementId: string, version: number): Promise<AgreementVersion> =>
      request(
        AgreementVersion,
        `${series(agreementId)}/versions/${parseInput(AgreementVersionNumber, version)}`,
      ),
    /** 409 VERSION_CONFLICT, AGREEMENT_ARCHIVED, PDF_REQUIRED, FILE_NOT_READY or FILE_BLOCKED. */
    publish: async (
      agreementId: string,
      body: PublishAgreementVersionRequest,
    ): Promise<AgreementVersion> =>
      request(AgreementVersion, `${series(agreementId)}/versions`, {
        method: 'POST',
        body: parseInput(PublishAgreementVersionRequest, body),
      }),
    /** Service agreements only: 409 FIRM_WIDE_REQUIRED for the firm-wide one. */
    archive: async (agreementId: string): Promise<FirmAgreementSummary> =>
      request(FirmAgreementSummary, `${series(agreementId)}/archive`, { method: 'POST' }),

    /** Step 1 of 3: a one-time PUT URL for the PDF (5 minutes). */
    createUpload: async (body: CreateAgreementUploadRequest): Promise<UploadTicket> =>
      request(UploadTicket, `${FILES}/uploads`, {
        method: 'POST',
        body: parseInput(CreateAgreementUploadRequest, body),
      }),
    /** Step 3 of 3: checks the stored PDF and starts the scan. */
    confirmUpload: async (body: ConfirmUploadRequest): Promise<AgreementFile> =>
      request(AgreementFile, `${FILES}/confirm`, {
        method: 'POST',
        body: parseInput(ConfirmUploadRequest, body),
      }),
    /** Poll until scanStatus is CLEAN (or INFECTED/FAILED: upload again). */
    file: async (fileId: string): Promise<AgreementFile> =>
      request(AgreementFile, `${FILES}/${id(fileId)}`),
    /** A 5-minute attachment link; 409 SCAN_PENDING or FILE_BLOCKED until CLEAN. */
    download: async (fileId: string): Promise<DownloadLink> =>
      request(DownloadLink, `${FILES}/${id(fileId)}/download`),
  };
}

export type AgreementsClient = ReturnType<typeof createAgreementsClient>;

/**
 * `api.publicAgreements(slug)`: the agreements a visitor or client signs before an intake
 * submits, for Begin Online and the portal intake tab. No sign-in; an unknown or inactive firm,
 * another firm's service or an archived agreement answers 404.
 */
export function createPublicAgreementsClient(request: ApiRequest, firmSlug: string) {
  const base = `/portal/${encodeURIComponent(firmSlug.toLowerCase())}/intake-agreements`;
  return {
    block: async (query: IntakeAgreementsQuery = {}): Promise<IntakeAgreementBlock> =>
      request(IntakeAgreementBlock, `${base}${toQuery(parseInput(IntakeAgreementsQuery, query))}`),
    /** The current version's PDF original, as a 5-minute attachment link; 404 otherwise. */
    downloadPdf: async (agreementId: string, version: number): Promise<DownloadLink> =>
      request(
        DownloadLink,
        `${base}/${id(agreementId)}/versions/${parseInput(AgreementVersionNumber, version)}/pdf`,
      ),
  };
}

export type PublicAgreementsClient = ReturnType<typeof createPublicAgreementsClient>;
