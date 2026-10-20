'use client';

import { Lock, Signature, UploadSimple } from '@phosphor-icons/react';
import type { PortalInfo } from '@firmivra/types';
import { Button, Modal } from '@firmivra/ui';
import Image from 'next/image';
import type { CSSProperties, ReactNode } from 'react';
import { textOn } from '../../../../../../lib/theme';
import { Quiet } from './settings-look';
import type { Draft } from './settings-model';

type Branding = PortalInfo['branding'];

/**
 * The firm's look for a sample form: the portal's firm colour variables on the preview only
 * (sidebar band and buttons), from Settings > Branding. With "Use this branding" off, or before
 * the branding loads, Firmivra's own navy and blue.
 */
function brandStyle(branding: Branding | undefined, useFirm: boolean): CSSProperties {
  if (!useFirm || !branding) {
    return {
      '--color-firm-sidebar': 'var(--color-platform-navy)',
      '--color-on-firm-sidebar': 'var(--color-white)',
      '--color-firm-button': 'var(--color-platform-blue)',
      '--color-on-firm-button': 'var(--color-white)',
    } as CSSProperties;
  }
  const band = branding.sidebarColor ?? branding.primaryColor;
  const button = branding.buttonColor ?? branding.primaryColor;
  return {
    '--color-firm-sidebar': band,
    '--color-on-firm-sidebar': textOn(band),
    '--color-firm-button': button,
    '--color-on-firm-button': textOn(button),
  } as CSSProperties;
}

/** The band at the top of a form: the firm's logo for dark backgrounds, or its name. */
function Band({
  firmName,
  branding,
  useFirm,
  size,
}: {
  firmName: string;
  branding: Branding | undefined;
  useFirm: boolean;
  size: 'sm' | 'lg';
}) {
  const logo = useFirm ? branding?.logoUrl : null;
  return (
    <div
      className={`flex items-center justify-center bg-firm-sidebar text-on-firm-sidebar ${size === 'sm' ? 'h-12 px-3' : 'h-20 px-6'}`}
    >
      {logo ? (
        <Image
          unoptimized
          src={logo}
          alt={firmName}
          width={size === 'sm' ? 120 : 200}
          height={size === 'sm' ? 32 : 56}
          className={`h-auto w-auto ${size === 'sm' ? 'max-h-8' : 'max-h-14'}`}
        />
      ) : (
        <span className={`font-bold ${size === 'sm' ? 'text-sm' : 'text-lg'}`}>{firmName}</span>
      )}
    </div>
  );
}

const SAMPLE_TITLE = 'Sample Intake Form';

/** Client Preview (right column): a sample form's first page with the selected settings. */
export function MiniPreview({
  draft,
  firmName,
  branding,
}: {
  draft: Draft | null;
  firmName: string;
  branding: Branding | undefined;
}) {
  const useFirm = draft?.branding.useFirmBranding ?? true;
  return (
    <div
      style={brandStyle(branding, useFirm)}
      className="mx-auto w-full overflow-hidden rounded-lg border border-border bg-surface shadow-md"
      data-testid="client-preview-sample"
    >
      <Band firmName={firmName} branding={branding} useFirm={useFirm} size="sm" />
      <div className="flex flex-col gap-2 p-3">
        {draft?.clientExperience.showProgressBar !== false ? (
          <div aria-hidden className="h-1.5 rounded-pill bg-disabled">
            <span className="block h-full w-1/3 rounded-pill bg-firm-button" />
          </div>
        ) : null}
        <p className="text-sm font-bold text-heading">{SAMPLE_TITLE}</p>
        <p className="text-xs text-muted">
          {draft?.general.allowSaveAndResume === false
            ? "Let's get started."
            : "Let's get started. You can save and finish later."}
        </p>
        <span
          aria-hidden
          className="rounded-control bg-firm-button py-1.5 text-center text-xs font-semibold text-on-firm-button"
        >
          Next
        </span>
      </div>
    </div>
  );
}

function SampleField({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-text">{label}</span>
      <span className="flex min-h-10 items-center gap-2 rounded-control border border-border bg-subtle px-3 text-sm text-muted">
        {children}
      </span>
    </div>
  );
}

/**
 * Preview Client View / Preview Form / View Full Preview: the larger sample form with every
 * selected setting that changes what a client sees. Nothing is sent and no form is created.
 */
export function FullPreview({
  open,
  onClose,
  draft,
  firmName,
  branding,
}: {
  open: boolean;
  onClose: () => void;
  draft: Draft | null;
  firmName: string;
  branding: Branding | undefined;
}) {
  return (
    <Modal
      open={open}
      title="Client Preview"
      subtitle="A sample form with the settings on this page, including changes not saved yet. Nothing is sent."
      onClose={onClose}
      footer={<Button onClick={onClose}>Close Preview</Button>}
    >
      {draft ? (
        <FullSample draft={draft} firmName={firmName} branding={branding} />
      ) : (
        <Quiet>The preview shows once the settings have loaded.</Quiet>
      )}
    </Modal>
  );
}

function FullSample({
  draft,
  firmName,
  branding,
}: {
  draft: Draft;
  firmName: string;
  branding: Branding | undefined;
}) {
  const { general, clientExperience: c, security } = draft;
  const useFirm = draft.branding.useFirmBranding;
  const thanks = c.thankYouMessage.trim() || 'Thank you! Your form was submitted.';
  return (
    <div className="flex flex-col gap-4" data-testid="client-preview-full">
      <div
        style={brandStyle(branding, useFirm)}
        className="overflow-hidden rounded-lg border border-border bg-surface"
      >
        <Band firmName={firmName} branding={branding} useFirm={useFirm} size="lg" />
        <div className="flex flex-col gap-4 p-5">
          {c.showProgressBar ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted">Step 1 of 3</span>
              <div aria-hidden className="h-2 rounded-pill bg-disabled">
                <span className="block h-full w-1/3 rounded-pill bg-firm-button" />
              </div>
            </div>
          ) : null}
          <div>
            <p className="text-lg font-bold text-heading">{SAMPLE_TITLE}</p>
            <p className="text-sm text-muted">
              {general.defaultExpirationDays
                ? `Please finish within ${general.defaultExpirationDays} days of receiving it.`
                : "Let's get started."}
            </p>
          </div>
          <SampleField label="Full name">Your answer</SampleField>
          <SampleField label="Supporting documents">
            <UploadSimple aria-hidden weight="fill" className="size-4 shrink-0" />
            {security.acceptedFileTypes.length
              ? `${security.acceptedFileTypes.join(', ')} up to ${security.maxFileSizeMb} MB each`
              : 'No file types chosen'}
            <Lock aria-hidden weight="fill" className="ml-auto size-4 shrink-0" />
          </SampleField>
          {general.requireSignature ? (
            <SampleField label="Signature">
              <Signature aria-hidden weight="fill" className="size-4 shrink-0" />
              Sign here
            </SampleField>
          ) : null}
          {security.consentRequired ? (
            <p className="flex items-center gap-2 text-sm text-text">
              <span
                aria-hidden
                className="size-4 shrink-0 rounded-sm border border-control-border"
              />
              Consent checkbox (your firm&apos;s consent wording)
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-3">
            {general.allowSaveAndResume ? (
              <span className="rounded-control border border-border px-4 py-2 text-sm font-medium text-text">
                Save and finish later
              </span>
            ) : null}
            <span className="rounded-control bg-firm-button px-6 py-2 text-sm font-semibold text-on-firm-button">
              Next
            </span>
          </div>
        </div>
      </div>
      <div className="rounded-lg bg-subtle p-4 text-sm text-text">
        <p className="font-semibold text-heading">After the client submits</p>
        <p className="mt-1 whitespace-pre-wrap">{thanks}</p>
        {c.redirectAfterCompletion && c.redirectUrl.trim() ? (
          <p className="mt-1 break-all text-muted">Then they go to {c.redirectUrl.trim()}</p>
        ) : null}
      </div>
    </div>
  );
}
