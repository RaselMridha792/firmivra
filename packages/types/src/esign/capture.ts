import { z } from 'zod';
import { SignatureMethod } from '../db-enums.js';

// Signature capture, shared by intake signing (R14) and Firm Sign (R13 owns this file once it
// merges). The API's esign/core applies the same normalisation before it hashes the evidence.

/** Control, format (zero-width, bidi) and line or paragraph separator characters. */
const HIDDEN_CHARACTERS = /[\p{Cc}\p{Cf}\u2028\u2029]/u;

/**
 * The comparison form of a signed name: Unicode NFC, runs of whitespace collapsed to one space,
 * trimmed, lower-cased. A typed signature matches the printed name when both forms are equal.
 */
export function signatureNameKey(value: string): string {
  return value.normalize('NFC').replace(/\s+/gu, ' ').trim().toLowerCase();
}

/** A printed name or typed signature: 1 to 200 characters, no hidden characters. */
export const SignatureText = z
  .string()
  .max(200)
  .refine((s) => !HIDDEN_CHARACTERS.test(s), { message: 'Remove hidden or control characters.' })
  .refine((s) => signatureNameKey(s).length > 0, { message: 'Enter your name.' });

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
