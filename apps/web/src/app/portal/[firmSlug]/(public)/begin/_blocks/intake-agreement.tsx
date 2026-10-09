'use client';

import { Checkbox, Input } from '@firmivra/ui';
import { SectionPanel } from './form-blocks';

export interface AgreementState {
  agreed: boolean;
  name: string;
  date: string;
}

export const agreementComplete = (a: AgreementState) =>
  a.agreed && a.name.trim().length > 1 && /^\d{4}-\d{2}-\d{2}$/.test(a.date);

/**
 * The review step's agreement and signature. R14's agreements (#259) bring the firm's published
 * agreement text, its acknowledgments and the signature the submit sends; until they are on main
 * this panel shows the frame from the mockups and the submit sends no signature (contract B's
 * TODO(R14)).
 */
export function AgreementPanel({
  title,
  value,
  onChange,
  error,
}: {
  title: string;
  value: AgreementState;
  onChange: (value: AgreementState) => void;
  error: string;
}) {
  const service = title.replace(/\s*Intake Form$/i, '');
  return (
    <SectionPanel
      title={`${service} Service Agreement`}
      subtitle="Please read the agreement, then sign below."
      className="mt-3"
    >
      <div
        tabIndex={0}
        role="region"
        aria-label="Service agreement"
        className="max-h-48 overflow-y-auto rounded-control border border-folder-border bg-folder-surface p-3 text-xs"
      >
        <p className="font-semibold text-heading">{service.toUpperCase()} SERVICE AGREEMENT</p>
        <p className="mt-1">
          Your firm&apos;s service agreement for this service is shown here for you to read before
          you sign. It explains the services, your responsibilities, fees, confidentiality and how
          either side can end the engagement.
        </p>
      </div>
      <div className="mt-2 space-y-2">
        <Checkbox
          label="I have read and understand the Service Agreement in its entirety. I agree to the terms and conditions. *"
          className="gap-2! text-xs! sm:min-h-6!"
          checked={value.agreed}
          onChange={(event) => onChange({ ...value, agreed: event.target.checked })}
        />
        <div className="grid gap-2 sm:grid-cols-2 [&_label]:text-xs">
          <Input
            label="Full Name (type your name to sign) *"
            autoComplete="name"
            value={value.name}
            onChange={(event) => onChange({ ...value, name: event.target.value })}
            className="font-display text-lg italic"
          />
          <Input
            label="Date *"
            type="date"
            value={value.date}
            onChange={(event) => onChange({ ...value, date: event.target.value })}
          />
        </div>
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    </SectionPanel>
  );
}
