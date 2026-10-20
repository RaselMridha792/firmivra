'use client';

import { Bell, GearSix, Lightning, Palette, ShieldCheck, User } from '@phosphor-icons/react';
import type { PortalInfo } from '@firmivra/types';
import { Button, Checkbox, Modal, normalizeHex } from '@firmivra/ui';
import Image from 'next/image';
import { useId, useState } from 'react';
import {
  type FrameState,
  InputRow,
  SelectRow,
  SettingsCard,
  TextareaRow,
  ToggleRow,
} from './settings-look';
import {
  ALERT_HOURS,
  type Draft,
  EXPIRATION_DAYS,
  FILE_TYPES,
  type FieldErrors,
  type FileType,
  FINAL_REMINDER_DAYS,
  FIRST_REMINDER_DAYS,
  type Group,
  MAX_FILE_SIZES,
  type SectionId,
  withCurrent,
} from './settings-model';

/** What every card needs: the draft, how to change it, the field errors and the frame state. */
export interface CardProps {
  draft: Draft | null;
  set: <G extends Group>(group: G, patch: Partial<Draft[G]>) => void;
  errors: FieldErrors;
  state: FrameState;
  /** Staff see the settings but only an owner or admin changes them. */
  readOnly: boolean;
  onEdit: (section: SectionId) => void;
}

export interface Member {
  userId: string;
  name: string;
}

const dayOptions = (values: number[]) =>
  values.map((n) => ({ value: String(n), label: `${n} ${n === 1 ? 'day' : 'days'}` }));

/** The firm's active members, plus the saved owner if the list does not have them. */
function ownerOptions(members: Member[], current: Member | null) {
  const list =
    current && !members.some((m) => m.userId === current.userId) ? [current, ...members] : members;
  return [
    { value: '', label: 'Not assigned' },
    ...list.map((m) => ({ value: m.userId, label: m.name })),
  ];
}

export function GeneralCard({
  draft,
  set,
  errors,
  state,
  readOnly,
  onEdit,
  members,
  savedOwner,
}: CardProps & { members: Member[]; savedOwner: Member | null }) {
  const g = draft?.general;
  const w = 'w-32';
  return (
    <SettingsCard
      section="general"
      title="General Settings"
      icon={GearSix}
      state={state}
      rows={5}
      onEdit={onEdit}
      editLabel="Edit General Settings"
    >
      {g ? (
        <>
          <SelectRow
            label="Default form expiration"
            width={w}
            value={g.defaultExpirationDays === null ? '' : String(g.defaultExpirationDays)}
            options={[
              ...(g.defaultExpirationDays === null ? [{ value: '', label: 'Choose…' }] : []),
              ...dayOptions(withCurrent(EXPIRATION_DAYS, g.defaultExpirationDays)),
            ]}
            disabled={readOnly}
            error={errors['general.defaultExpirationDays']}
            onChange={(v) => set('general', { defaultExpirationDays: v ? Number(v) : null })}
          />
          <ToggleRow
            label="Allow save and resume"
            width={w}
            checked={g.allowSaveAndResume}
            disabled={readOnly}
            onChange={(on) => set('general', { allowSaveAndResume: on })}
          />
          <ToggleRow
            label="Require e-signature"
            width={w}
            checked={g.requireSignature}
            disabled={readOnly}
            onChange={(on) => set('general', { requireSignature: on })}
          />
          <ToggleRow
            label="Auto-generate submission ID"
            width={w}
            checked={g.autoSubmissionId}
            disabled={readOnly}
            onChange={(on) => set('general', { autoSubmissionId: on })}
          />
          <SelectRow
            label="Assigned owner"
            width={w}
            value={g.defaultOwnerUserId ?? ''}
            options={ownerOptions(members, savedOwner)}
            disabled={readOnly}
            error={errors['general.defaultOwnerUserId']}
            onChange={(v) => set('general', { defaultOwnerUserId: v || null })}
          />
        </>
      ) : null}
    </SettingsCard>
  );
}

export function ClientExperienceCard({ draft, set, errors, state, readOnly, onEdit }: CardProps) {
  const c = draft?.clientExperience;
  return (
    <SettingsCard
      section="client"
      title="Client Experience"
      icon={User}
      state={state}
      rows={5}
      onEdit={onEdit}
      editLabel="Edit Client Experience"
    >
      {c ? (
        <>
          <ToggleRow
            label="Show progress bar"
            width="w-20"
            checked={c.showProgressBar}
            disabled={readOnly}
            onChange={(on) => set('clientExperience', { showProgressBar: on })}
          />
          <ToggleRow
            label="Allow mobile-friendly view"
            width="w-20"
            checked={c.mobileFriendly}
            fixed="Client pages always fit a phone, so this stays on."
            onChange={() => undefined}
          />
          <TextareaRow
            label="Custom thank-you message"
            labelWidth="w-28"
            value={c.thankYouMessage}
            maxLength={500}
            placeholder="Shown after the client submits"
            disabled={readOnly}
            error={errors['clientExperience.thankYouMessage']}
            onChange={(v) => set('clientExperience', { thankYouMessage: v })}
          />
          <ToggleRow
            label="Redirect after completion"
            width="w-20"
            checked={c.redirectAfterCompletion}
            disabled={readOnly}
            onChange={(on) => set('clientExperience', { redirectAfterCompletion: on })}
          />
          <InputRow
            label="Redirect URL (optional)"
            labelWidth="w-28"
            type="url"
            value={c.redirectUrl}
            maxLength={2048}
            placeholder="https://"
            disabled={readOnly}
            error={errors['clientExperience.redirectUrl']}
            onChange={(v) => set('clientExperience', { redirectUrl: v })}
          />
        </>
      ) : null}
    </SettingsCard>
  );
}

export function NotificationsCard({ draft, set, errors, state, readOnly, onEdit }: CardProps) {
  const n = draft?.notifications;
  const w = 'w-40';
  return (
    <SettingsCard
      section="notifications"
      title="Notifications & Reminders"
      icon={Bell}
      state={state}
      rows={5}
      onEdit={onEdit}
      editLabel="Edit Notifications & Reminders"
    >
      {n ? (
        <>
          <ToggleRow
            label="Send confirmation email to client"
            width="w-20"
            checked={n.sendClientConfirmation}
            disabled={readOnly}
            onChange={(on) => set('notifications', { sendClientConfirmation: on })}
          />
          <ToggleRow
            label="Notify assigned staff member"
            width="w-20"
            checked={n.notifyAssignedStaff}
            disabled={readOnly}
            onChange={(on) => set('notifications', { notifyAssignedStaff: on })}
          />
          <SelectRow
            label="First reminder after"
            width={w}
            value={n.firstReminderAfterDays === null ? '' : String(n.firstReminderAfterDays)}
            options={[
              { value: '', label: 'No reminder' },
              ...dayOptions(withCurrent(FIRST_REMINDER_DAYS, n.firstReminderAfterDays)),
            ]}
            disabled={readOnly}
            error={errors['notifications.firstReminderAfterDays']}
            onChange={(v) => set('notifications', { firstReminderAfterDays: v ? Number(v) : null })}
          />
          <SelectRow
            label="Final reminder after"
            width={w}
            value={n.finalReminderAfterDays === null ? '' : String(n.finalReminderAfterDays)}
            options={[
              { value: '', label: 'No reminder' },
              ...dayOptions(withCurrent(FINAL_REMINDER_DAYS, n.finalReminderAfterDays)),
            ]}
            disabled={readOnly}
            error={errors['notifications.finalReminderAfterDays']}
            onChange={(v) => set('notifications', { finalReminderAfterDays: v ? Number(v) : null })}
          />
          <SelectRow
            label="Expiration alert"
            width={w}
            value={n.expirationAlertHours === null ? '' : String(n.expirationAlertHours)}
            options={[
              { value: '', label: 'No alert' },
              ...withCurrent(ALERT_HOURS, n.expirationAlertHours).map((h) => ({
                value: String(h),
                label: `${h} hours before`,
              })),
            ]}
            disabled={readOnly}
            error={errors['notifications.expirationAlertHours']}
            onChange={(v) => set('notifications', { expirationAlertHours: v ? Number(v) : null })}
          />
        </>
      ) : null}
    </SettingsCard>
  );
}

export function AutomationCard({
  draft,
  set,
  errors,
  state,
  readOnly,
  onEdit,
  members,
  savedOwner,
}: CardProps & { members: Member[]; savedOwner: Member | null }) {
  const a = draft?.automation;
  return (
    <SettingsCard
      section="automation"
      title="Automation Rules"
      icon={Lightning}
      state={state}
      rows={4}
      onEdit={onEdit}
      editLabel="Edit Automation Rules"
    >
      {a ? (
        <>
          <ToggleRow
            label="Auto-create client record"
            width="w-20"
            checked={a.autoCreateClient}
            disabled={readOnly}
            onChange={(on) => set('automation', { autoCreateClient: on })}
          />
          <ToggleRow
            label="Auto-create follow-up task"
            width="w-20"
            checked={a.autoCreateFollowUpTask}
            disabled={readOnly}
            onChange={(on) => set('automation', { autoCreateFollowUpTask: on })}
          />
          <ToggleRow
            label="Route by service type"
            width="w-20"
            checked={a.routeByServiceType}
            disabled={readOnly}
            onChange={(on) => set('automation', { routeByServiceType: on })}
          />
          <SelectRow
            label="Default follow-up owner"
            width="w-32"
            value={a.defaultFollowUpOwnerUserId ?? ''}
            options={ownerOptions(members, savedOwner)}
            disabled={readOnly}
            error={errors['automation.defaultFollowUpOwnerUserId']}
            onChange={(v) => set('automation', { defaultFollowUpOwnerUserId: v || null })}
          />
        </>
      ) : null}
    </SettingsCard>
  );
}

/** Accepted file types: the field shows the chosen codes; a dialog ticks them. */
function FileTypesRow({
  value,
  onChange,
  error,
  disabled,
}: {
  value: FileType[];
  onChange: (types: FileType[]) => void;
  error?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span id={`${id}-label`} className="min-w-0 flex-1 pt-1 text-sm text-text">
        Accepted file types
      </span>
      <div className="flex w-40 min-w-0 shrink-0 flex-col gap-1">
        <button
          type="button"
          aria-labelledby={`${id}-label ${id}-value`}
          aria-describedby={error ? `${id}-error` : undefined}
          aria-haspopup="dialog"
          disabled={disabled}
          onClick={() => setOpen(true)}
          className={`w-full truncate rounded-control border bg-surface px-3 py-1 text-left text-sm text-text disabled:cursor-not-allowed disabled:bg-disabled ${error ? 'border-danger' : 'border-border'}`}
        >
          <span id={`${id}-value`}>{value.length ? value.join(', ') : 'None chosen'}</span>
        </button>
        {error ? (
          <p id={`${id}-error`} className="text-xs text-danger">
            {error}
          </p>
        ) : null}
      </div>
      <Modal
        open={open}
        title="Accepted file types"
        subtitle="What clients may upload with an intake form. Files are always stored encrypted."
        onClose={() => setOpen(false)}
        footer={<Button onClick={() => setOpen(false)}>Done</Button>}
      >
        <fieldset className="grid grid-cols-2 gap-x-4 sm:grid-cols-3">
          <legend className="sr-only">File types</legend>
          {FILE_TYPES.map((type) => (
            <Checkbox
              key={type}
              label={type}
              checked={value.includes(type)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? FILE_TYPES.filter((t) => t === type || value.includes(t))
                    : value.filter((t) => t !== type),
                )
              }
            />
          ))}
        </fieldset>
        {value.length === 0 ? (
          <p className="mt-2 text-xs text-danger">Choose at least one file type.</p>
        ) : null}
      </Modal>
    </div>
  );
}

export function SecurityCard({ draft, set, errors, state, readOnly, onEdit }: CardProps) {
  const s = draft?.security;
  return (
    <SettingsCard
      section="security"
      title="Security & Compliance"
      icon={ShieldCheck}
      state={state}
      rows={4}
      onEdit={onEdit}
      editLabel="Edit Security & Compliance"
    >
      {s ? (
        <>
          <ToggleRow
            label="Enable encrypted file uploads"
            width="w-20"
            checked
            fixed="Uploaded files are always stored encrypted."
            onChange={() => undefined}
          />
          <FileTypesRow
            value={s.acceptedFileTypes}
            disabled={readOnly}
            error={errors['security.acceptedFileTypes']}
            onChange={(acceptedFileTypes) => set('security', { acceptedFileTypes })}
          />
          <SelectRow
            label="Max file size per file"
            width="w-40"
            value={String(s.maxFileSizeMb)}
            options={withCurrent(MAX_FILE_SIZES, s.maxFileSizeMb).map((mb) => ({
              value: String(mb),
              label: `${mb} MB`,
            }))}
            disabled={readOnly}
            error={errors['security.maxFileSizeMb']}
            onChange={(v) => set('security', { maxFileSizeMb: Number(v) })}
          />
          <ToggleRow
            label="Consent checkbox required"
            width="w-20"
            checked={s.consentRequired}
            disabled={readOnly}
            onChange={(on) => set('security', { consentRequired: on })}
          />
        </>
      ) : null}
    </SettingsCard>
  );
}

/** A colour of the firm's branding: its swatch and code, set in Settings > Branding. */
function Colour({ label, hex }: { label: string; hex: string | null }) {
  const value = hex ? normalizeHex(hex) : null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
      <span className="text-sm text-text">{label}</span>
      <span className="inline-flex items-center gap-2 rounded-control border border-border bg-surface px-2 py-1 text-xs text-text">
        <span
          aria-hidden
          className="size-4 shrink-0 rounded-sm border border-border bg-disabled"
          style={value ? { backgroundColor: value } : undefined}
        />
        {value ? value.toUpperCase() : 'Not set'}
      </span>
    </div>
  );
}

export function BrandingCard({
  draft,
  set,
  state,
  readOnly,
  onEdit,
  firmName,
  branding,
  brandingFailed,
}: CardProps & {
  firmName: string;
  branding: PortalInfo['branding'] | undefined;
  brandingFailed: boolean;
}) {
  const b = draft?.branding;
  const logo = branding?.logoLightUrl ?? branding?.logoUrl ?? null;
  return (
    <SettingsCard
      section="branding"
      title="Branding"
      icon={Palette}
      state={state}
      rows={3}
      onEdit={onEdit}
      editHref="/settings/branding"
      editLabel="Edit branding in Settings"
    >
      {b ? (
        <>
          <div className="flex flex-col gap-3 py-1 sm:flex-row sm:items-center">
            <div className="flex h-20 w-full shrink-0 items-center justify-center rounded-lg bg-canvas px-3 sm:w-36">
              {logo ? (
                <Image
                  unoptimized
                  src={logo}
                  alt={`${firmName} logo`}
                  width={128}
                  height={64}
                  className="h-auto max-h-16 w-auto"
                />
              ) : (
                <span className="text-center text-xs text-muted">
                  {brandingFailed
                    ? 'The logo could not be loaded right now.'
                    : branding
                      ? 'No logo yet'
                      : 'Loading…'}
                </span>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Colour
                label="Primary button color"
                hex={branding ? (branding.buttonColor ?? branding.primaryColor) : null}
              />
              <Colour label="Accent color" hex={branding?.accentColor ?? null} />
            </div>
          </div>
          <ToggleRow
            label="Use this branding on client-facing forms"
            width="w-18"
            labelClass="text-xs text-info"
            checked={b.useFirmBranding}
            disabled={readOnly}
            onChange={(on) => set('branding', { useFirmBranding: on })}
          />
        </>
      ) : null}
    </SettingsCard>
  );
}
