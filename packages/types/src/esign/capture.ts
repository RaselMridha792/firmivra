import { z } from 'zod';
import { ONE_LINE, text } from '../clients/text.js';
import { SignatureMethod } from '../db-enums.js';

// Signature capture, shared by intake signing (R14) and Firm Sign (R13 owns this file once it
// merges). The API's esign/core applies the same normalisation before it hashes the evidence.

/**
 * The comparison form of a signed name: Unicode NFC, runs of whitespace collapsed to one space,
 * trimmed, lower-cased. A typed signature matches the printed name when both forms are equal.
 */
export function signatureNameKey(value: string): string {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim().toLowerCase();
}

/**
 * True when a signed name is visible text on one line: the clients' ONE_LINE rule (no control,
 * invisible, bidi-override or blank-looking filler characters, no lone surrogates; the
 * zero-width joiners, soft hyphen and direction marks that real names use stay allowed).
 */
export const isVisibleSignatureText = (value: string): boolean => ONE_LINE.test(value);

/** A printed name or typed signature: trimmed, 1 to 200 characters, visible text on one line. */
export const SignatureText = text(200, 'one', 'Enter your name.');

/** Intake signing is typed for Oct 18; Firm Sign adds DRAWN and UPLOADED with its own fields. */
export const CaptureMethod = SignatureMethod.extract(['TYPED']);
export type CaptureMethod = z.infer<typeof CaptureMethod>;

/** What the signer enters: the printed name, and the typed signature that must match it. */
export const SignatureCaptureInput = z
  .strictObject({
    printedName: SignatureText,
    method: CaptureMethod,
    typedSignature: SignatureText,
  })
  .refine((v) => signatureNameKey(v.typedSignature) === signatureNameKey(v.printedName), {
    path: ['typedSignature'],
    message: 'Type your name exactly as printed.',
  });
export type SignatureCaptureInput = z.infer<typeof SignatureCaptureInput>;
