import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { databaseErrorCode, type TxClient } from '@firmivra/db';
import {
  type AgreementOutdatedDetails,
  INTAKE_SIGNING_ERRORS,
  type IntakeSignatureInput,
  type IntakeSignatureSummary,
  type IntakeSigningErrorCode,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { requestContext } from '../common/request-context.js';
import {
  canonicalIp,
  evidenceSha256,
  hasHiddenCharacters,
  normalizeSignedText,
  signatureMatches,
  storedUserAgent,
} from '../esign/core/evidence.js';
import { currentAgreements } from './agreements.service.js';

export interface SignIntakeInput {
  businessId: string;
  intakeId: string;
  /** The draft version being submitted. */
  submissionId: string;
  /** The intake form's service, whose agreements are signed with the firm-wide one. */
  serviceId: string | null;
  /**
   * Begin Online: the intake's lead; `acceptLegal` is required when the firm has published both
   * Terms and Privacy (the block's `legal`). Portal: the signed-in client's login, who accepted
   * them at sign-up; `acceptLegal` is refused.
   */
  signer:
    | { kind: 'lead'; leadId: string; email: string | null }
    | { kind: 'client'; clientAccountId: string };
  signature: z.output<typeof IntakeSignatureInput>;
}

/**
 * What the caller copies onto the submission in the same transaction, next to submitted_at:
 * the database refuses a submit whose signer_name, signed_at, signer_ip and signer_user_agent
 * differ from the signature's, or whose signature came from another transaction. The answers
 * must be saved on the draft before `sign()`: the database hashes them and freezes them.
 * A portal submit runs with the client's actorUserId (the database checks the login).
 */
export interface SignedIntake {
  signatureId: string;
  printedName: string;
  signedAt: Date;
  ip: string | null;
  userAgent: string | null;
  evidenceSha256: string;
}

const SIGNING_STATUS: Record<IntakeSigningErrorCode, 400 | 409> = {
  NO_INTAKE_AGREEMENT: 409,
  AGREEMENT_OUTDATED: 409,
  ACKNOWLEDGMENT_REQUIRED: 400,
  SIGNATURE_MISMATCH: 400,
  TERMS_OUTDATED: 409,
};
/** A submit-time refusal with the contract's code and words (INTAKE_SIGNING_ERRORS). */
const signingError = (code: IntakeSigningErrorCode, details?: AgreementOutdatedDetails) => {
  const body = { code, message: INTAKE_SIGNING_ERRORS[code], ...(details ? { details } : {}) };
  return SIGNING_STATUS[code] === 409 ? new ConflictException(body) : new BadRequestException(body);
};
const invalid = (message: string) =>
  new BadRequestException({ code: 'VALIDATION_FAILED', message });

/**
 * The database's refusal of a signature row as the contract's answer, or undefined. The
 * intake_signatures_typed_matches check compares the names with Postgres' own folding, which
 * can differ from signatureNameKey (e.g. a dotted capital I): 400 SIGNATURE_MISMATCH, never a 500.
 */
export function signingRefusal(error: unknown) {
  if (databaseErrorCode(error) !== '23514') return undefined;
  const meta = (error as { meta?: { driverAdapterError?: { cause?: unknown } } } | null)?.meta;
  const cause = meta?.driverAdapterError?.cause as
    { originalMessage?: unknown; constraint?: unknown } | undefined;
  const text = [cause?.originalMessage, cause?.constraint, (error as Error | null)?.message]
    .filter((t): t is string => typeof t === 'string')
    .join(' ');
  return text.includes('intake_signatures_typed_matches')
    ? signingError('SIGNATURE_MISMATCH')
    : undefined;
}

/**
 * Intake signing (R14 step 9): R15's Begin Online and portal submits call `sign()` inside their
 * submit transaction, right before setting submitted_at. The agreement series are read FOR SHARE,
 * so a publish waits for the signature and a signature never pins a version that was replaced
 * while it ran. The evidence rows are insert-only; the database sets signed_at.
 */
@Injectable()
export class IntakeSignaturesService {
  constructor(private readonly audit: AuditService) {}

  async sign(tx: TxClient, input: SignIntakeInput): Promise<SignedIntake> {
    const { businessId, signature } = input;
    const serviceId = input.serviceId ?? undefined;
    await tx.$executeRaw`
      SELECT 1 FROM firm_agreements
      WHERE archived_at IS NULL
        AND (scope = 'ALL_INTAKES' OR service_id = ${serviceId ?? null}::uuid)
      FOR SHARE`;
    const block = await currentAgreements(tx, serviceId);
    if (!block.ready) throw signingError('NO_INTAKE_AGREEMENT');

    // Begin Online's Terms and Privacy: both published, or none asked (the block's `legal`).
    const beginOnline = input.signer.kind === 'lead';
    const legal = beginOnline ? await this.legalVersions(tx) : null;
    const sent = new Map(signature.agreements.map((a) => [a.agreementId, a]));
    const outdated =
      sent.size !== block.agreements.length ||
      block.agreements.some((a) => {
        const s = sent.get(a.agreementId);
        return !s || s.version !== a.version || s.bodySha256 !== a.bodySha256;
      });
    if (outdated) {
      const { versionIds: _ids, ...current } = block;
      throw signingError('AGREEMENT_OUTDATED', {
        ...current,
        legal: legal && {
          terms: { version: legal.terms.version },
          privacy: { version: legal.privacy.version },
        },
      });
    }

    const ticked = new Set(signature.acknowledgments.map((a) => `${a.agreementId}:${a.key}`));
    const known = new Set(
      block.agreements.flatMap((a) => a.acknowledgments.map((k) => `${a.agreementId}:${k.key}`)),
    );
    if ([...ticked].some((t) => !known.has(t))) {
      throw invalid('Unknown acknowledgment');
    }
    const acknowledgments = block.agreements.flatMap((a) =>
      a.acknowledgments.map((k) => ({
        agreementVersionId: block.versionIds.get(a.agreementId)!,
        key: k.key,
        label: k.label,
        text: k.text,
        required: k.required,
        checked: ticked.has(`${a.agreementId}:${k.key}`),
      })),
    );
    if (acknowledgments.some((a) => a.required && !a.checked)) {
      throw signingError('ACKNOWLEDGMENT_REQUIRED');
    }

    const { printedName, typedSignature } = signature.signer;
    const title = signature.title ?? null;
    if ([printedName, typedSignature, title ?? ''].some(hasHiddenCharacters)) {
      throw invalid('Remove hidden or control characters');
    }
    if (!signatureMatches(typedSignature, printedName)) throw signingError('SIGNATURE_MISMATCH');

    const accepted = signature.acceptLegal ?? null;
    let legalIds: { terms: string; privacy: string } | null = null;
    if (!beginOnline) {
      if (accepted) throw invalid('A portal intake takes no Terms and Privacy acceptance');
    } else if (legal) {
      if (!accepted) throw invalid('Accept the Terms and Privacy Policy');
      if (
        accepted.termsVersion !== legal.terms.version ||
        accepted.privacyVersion !== legal.privacy.version
      ) {
        throw signingError('TERMS_OUTDATED');
      }
      legalIds = { terms: legal.terms.id, privacy: legal.privacy.id };
    } else if (accepted) {
      throw invalid('The firm asks for no Terms and Privacy acceptance');
    }

    // signed_at is now() (the transaction's start) stored to the millisecond; reading it rounded
    // by the database keeps the evidence equal to the row. The answers hash is the database's
    // too: the hash of the stored answers, frozen from here on.
    const [draft] = await tx.$queryRaw<{ now: Date; answersSha256: string }[]>`
      SELECT now()::timestamptz(3) AS now,
             encode(sha256(convert_to(answers::text, 'UTF8')), 'hex') AS "answersSha256"
      FROM intake_submissions WHERE id = ${input.submissionId}::uuid`;
    if (!draft) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
    const { now, answersSha256 } = draft;
    const store = requestContext.getStore();
    const ip = canonicalIp(store?.ip);
    const userAgent = storedUserAgent(store?.userAgent);
    const stored = {
      printedName: normalizeSignedText(printedName),
      typedSignature: normalizeSignedText(typedSignature),
      title: title === null ? null : normalizeSignedText(title) || null,
    };
    const agreements = block.agreements.map((a) => ({
      agreementVersionId: block.versionIds.get(a.agreementId)!,
      bodySha256: a.bodySha256,
      pdfSha256: a.pdf.sha256,
    }));
    const evidence = evidenceSha256({
      v: 1,
      businessId,
      intakeId: input.intakeId,
      submissionId: input.submissionId,
      signer: input.signer,
      ...stored,
      method: signature.signer.method,
      agreements,
      acknowledgments,
      legal: legalIds,
      answersSha256,
      signedAt: now,
      ip,
      userAgent,
    });

    const row = await tx.intakeSignature
      .create({
        data: {
          businessId,
          submissionId: input.submissionId,
          intakeId: input.intakeId,
          leadId: input.signer.kind === 'lead' ? input.signer.leadId : null,
          clientAccountId: input.signer.kind === 'client' ? input.signer.clientAccountId : null,
          printedName: stored.printedName,
          signatureText: stored.typedSignature,
          signatureMethod: signature.signer.method,
          signerTitle: stored.title,
          signerEmail: input.signer.kind === 'lead' ? input.signer.email : null,
          acknowledgments,
          termsDocumentId: legalIds?.terms ?? null,
          privacyDocumentId: legalIds?.privacy ?? null,
          answersSha256,
          evidenceSha256: evidence,
          ip,
          userAgent,
          agreements: { create: agreements },
        },
        select: { id: true, signedAt: true },
      })
      .catch((error: unknown) => {
        throw signingRefusal(error) ?? error;
      });
    await this.audit.logIn(
      tx,
      'intake.signed',
      { type: 'intake_submission', id: input.submissionId },
      {
        signatureId: row.id,
        agreementVersionIds: agreements.map((a) => a.agreementVersionId),
        evidenceSha256: evidence,
      },
      { businessId },
    );
    return {
      signatureId: row.id,
      printedName: stored.printedName,
      signedAt: row.signedAt,
      ip,
      userAgent,
      evidenceSha256: evidence,
    };
  }

  /**
   * The signature on a submission version, or null. `showNetwork` (Owner and Admin) includes the
   * IP and user agent.
   */
  async summary(
    tx: TxClient,
    submissionId: string,
    options: { showNetwork: boolean },
  ): Promise<IntakeSignatureSummary | null> {
    const row = await tx.intakeSignature.findFirst({
      where: { submissionId },
      select: {
        id: true,
        printedName: true,
        signatureText: true,
        signatureMethod: true,
        signerTitle: true,
        signedAt: true,
        acknowledgments: true,
        answersSha256: true,
        evidenceSha256: true,
        ip: true,
        userAgent: true,
        terms: { select: { version: true } },
        privacy: { select: { version: true } },
        agreements: {
          select: {
            bodySha256: true,
            pdfSha256: true,
            agreementVersion: {
              select: { id: true, agreementId: true, version: true, title: true },
            },
          },
        },
      },
    });
    if (!row) return null;
    const agreementOf = new Map(
      row.agreements.map((a) => [a.agreementVersion.id, a.agreementVersion.agreementId]),
    );
    const acks = row.acknowledgments as {
      agreementVersionId: string;
      key: string;
      label: string;
      text: string;
      required?: boolean;
      checked: boolean;
    }[];
    return {
      id: row.id,
      printedName: row.printedName,
      typedSignature: row.signatureText,
      method: row.signatureMethod,
      title: row.signerTitle,
      signedAt: row.signedAt.toISOString(),
      agreements: row.agreements.map((a) => ({
        agreementId: a.agreementVersion.agreementId,
        version: a.agreementVersion.version,
        title: a.agreementVersion.title,
        bodySha256: a.bodySha256,
        pdfSha256: a.pdfSha256,
      })),
      acknowledgments: acks.map((a) => ({
        agreementId: agreementOf.get(a.agreementVersionId) ?? a.agreementVersionId,
        key: a.key,
        label: a.label,
        text: a.text,
        required: a.required ?? false,
        checked: a.checked,
      })),
      legal:
        row.terms && row.privacy
          ? { termsVersion: row.terms.version, privacyVersion: row.privacy.version }
          : null,
      answersSha256: row.answersSha256,
      evidenceSha256: row.evidenceSha256,
      ip: options.showNetwork ? row.ip : null,
      userAgent: options.showNetwork ? row.userAgent : null,
    };
  }

  /** The firm's current Terms and Privacy with their ids, or null unless both are published. */
  private async legalVersions(tx: TxClient) {
    const latest = (kind: 'TERMS' | 'PRIVACY') =>
      tx.firmLegalDocument.findFirst({
        where: { kind },
        orderBy: { version: 'desc' },
        select: { id: true, version: true },
      });
    const [terms, privacy] = await Promise.all([latest('TERMS'), latest('PRIVACY')]);
    return terms && privacy ? { terms, privacy } : null;
  }
}
