'use client';

import type { IntakeFormListItem, IntakeShare } from '@firmivra/types';
import { Button, Modal, Toggle } from '@firmivra/ui';
import { useFirm } from '../../../../../components/firm-context';
import { PublicLinkSection } from '../../../../../components/public-link';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { WebsiteGuide } from './website-guide';

/**
 * Whether a form is its service's main form (the service's default template of one of the six
 * kinds): it is reached through its service's Begin Online page. A hint only; the API decides.
 */
export const isMainForm = (form: Pick<IntakeFormListItem, 'isTemplate' | 'service' | 'category'>) =>
  form.isTemplate && form.service !== null && form.category !== 'OTHER';

const SHARE_ERRORS = { NOT_SHAREABLE: 'Publish the form before you share it.' };

function Switch({
  label,
  help,
  checked,
  disabled,
  onChange,
  testId,
}: {
  label: string;
  help: string;
  checked: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
  testId: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-divider p-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-heading">{label}</p>
        <p className="text-xs text-muted">{help}</p>
      </div>
      <Toggle
        label={label}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        data-testid={testId}
      />
    </div>
  );
}

/**
 * Share & Publish, titled with the form's name (Intake Forms Review Two, INTAKE-ACCESS-02): the
 * form's link and a website button that opens it, each with Copy (a main form's is its service's
 * Begin Online page; any other published form's its own share link), and two switches for the
 * Owner and Admin: the share link on or off (off, the link refuses at once) and Publish in client
 * portal (off by default: on, every client of the firm can open it in the portal). A draft or an
 * archived form is not shared. Mounted only while open; reading it changes nothing.
 */
export function FormLinkDialog({
  formId,
  name,
  onClose,
}: {
  formId: string;
  name: string;
  onClose: () => void;
}) {
  const { role } = useFirm();
  const manager = role === 'OWNER' || role === 'ADMIN';
  const key = ['intake-forms', 'form', formId, 'share'] as const;
  const share = useApiQuery(key, () => api.intakeForms.share(formId));
  const save = useApiMutation(
    (body: { sharing: boolean; portalPublished: boolean }) =>
      api.intakeForms.saveShare(formId, body),
    { invalidate: key },
  );
  const s: IntakeShare | undefined = save.data ?? share.data;
  const set = (patch: Partial<{ sharing: boolean; portalPublished: boolean }>) => {
    if (!s) return;
    save.mutate({ sharing: s.sharing, portalPublished: s.portalPublished, ...patch });
  };
  const emptyText = share.isPending
    ? 'Loading the form link…'
    : share.isError
      ? `The form link could not be loaded. ${errorMessage(share.error)}`
      : !s?.shareable
        ? 'Publish the form to share it. A draft or an archived form has no link.'
        : !s.main && !s.sharing
          ? 'Sharing by link is off. Turn it on to get the link and the website button.'
          : undefined;
  return (
    <Modal
      open
      title={name}
      subtitle="Share this form with a link or a button on your website, and choose whether clients see it in the portal."
      onClose={onClose}
      footer={
        <>
          {share.isError ? (
            <Button variant="secondary" onClick={() => void share.refetch()}>
              Try Again
            </Button>
          ) : null}
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="form-share">
        <PublicLinkSection kind="INTAKE_FORM" link={s?.link ?? null} emptyText={emptyText} />
        {/* Leads row 24: where the link or button goes on the common website builders. */}
        {s?.link ? <WebsiteGuide /> : null}
        {s ? (
          <div className="flex flex-col gap-3">
            {s.main ? (
              <p className="text-xs text-muted">
                This is the service&apos;s main form: its link is the service&apos;s Begin Online
                page.
              </p>
            ) : (
              <Switch
                label="Share by link"
                help="Anyone with the link can fill in the form; each visitor becomes a lead (source Website Form). Off, the link stops working at once."
                checked={s.sharing}
                disabled={!manager || save.isPending || (!s.shareable && !s.sharing)}
                onChange={(on) => set({ sharing: on })}
                testId="share-by-link"
              />
            )}
            <Switch
              label="Publish in client portal"
              help="On, every client of your firm can open and fill in this form in the portal, whatever their services. Off, it stays out of the portal list."
              checked={s.portalPublished}
              disabled={!manager || save.isPending || (!s.shareable && !s.portalPublished)}
              onChange={(on) => set({ portalPublished: on })}
              testId="publish-in-portal"
            />
            {manager ? null : (
              <p className="text-xs text-muted">Only an Owner or Admin can change these.</p>
            )}
            {save.isError ? (
              <p role="alert" className="text-sm text-danger">
                {errorMessage(save.error, SHARE_ERRORS)}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
