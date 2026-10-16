'use client';

import { type BrandingSettings, UpdateBrandingRequest } from '@firmivra/types';
import { Button, Callout, Input, Skeleton, Textarea } from '@firmivra/ui';
import { ChatText, EnvelopeSimple, Eye, Info, PaperPlaneTilt } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { useFirm } from '../../../../../../components/firm-context';
import { api } from '../../../../../../lib/api';
import { moduleHref } from '../../../../../../lib/firm-modules';
import { errorCode, errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { NOT_LOADED, Quiet, SettingsCard, SettingsHeader } from '../../_components/settings-parts';

interface Form {
  fromName: string;
  replyToEmail: string;
  header: string;
  footer: string;
  disclaimer: string;
}

const COMMS_ERRORS: Record<string, string> = {
  SAVE_CONFLICT:
    'Someone saved these settings while you were editing. Reload to see their changes, then make yours again.',
  FORBIDDEN: 'Only an Owner or an Admin can change communication settings.',
};

const fromBranding = (b: BrandingSettings): Form => ({
  fromName: b.email.fromName ?? '',
  replyToEmail: b.email.replyToEmail ?? '',
  header: b.email.header ?? '',
  footer: b.email.footer ?? '',
  disclaimer: b.email.disclaimer ?? '',
});

/**
 * Settings > Communications (guide §11, §17.1 Email & Communications): the sender name, reply-to
 * address, email header, footer and disclaimer the firm's messages use (`api.branding` email),
 * with a preview. The sending address itself comes from the verified sender, never typed here.
 */
export function CommunicationsScreen() {
  const branding = useApiQuery(['branding'], () => api.branding.get());
  const [saved, setSaved] = useState('');
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <SettingsHeader
        icon={PaperPlaneTilt}
        title="Communications"
        subtitle="Sender identity, reply-to, and the header and footer of your firm's emails."
      />
      {branding.data ? (
        <CommunicationsForm
          key={branding.data.version}
          branding={branding.data}
          saved={saved}
          onSaved={setSaved}
          onReload={() => void branding.refetch()}
        />
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          {['Sender Identity', 'Email Content', 'Preview', 'Text Messages'].map((title) => (
            <SettingsCard key={title} title={title} icon={EnvelopeSimple}>
              {branding.isPending ? <Skeleton className="h-24" /> : <Quiet>{NOT_LOADED}</Quiet>}
            </SettingsCard>
          ))}
        </div>
      )}
    </div>
  );
}

function CommunicationsForm({
  branding,
  saved,
  onSaved,
  onReload,
}: {
  branding: BrandingSettings;
  saved: string;
  onSaved: (text: string) => void;
  onReload: () => void;
}) {
  const { firm } = useFirm();
  const [form, setForm] = useState<Form>(() => fromBranding(branding));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useApiMutation(
    async (email: NonNullable<UpdateBrandingRequest['email']>) => {
      await api.branding.update({ version: branding.version, email });
      onSaved('Communication settings saved.');
    },
    { invalidate: ['branding'] },
  );
  const set = (k: keyof Form, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    onSaved('');
  };
  const firmName = firm?.name ?? 'Your firm';
  const fromName = form.fromName.trim() || firmName;

  return (
    <form
      noValidate
      aria-label="Communication settings"
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const email = {
          fromName: form.fromName.trim() || null,
          replyToEmail: form.replyToEmail.trim() || null,
          header: form.header.trim() || null,
          footer: form.footer.trim() || null,
          disclaimer: form.disclaimer.trim() || null,
        };
        const result = UpdateBrandingRequest.shape.email.safeParse(email);
        const found: Record<string, string> = {};
        if (!result.success) {
          for (const issue of result.error.issues) {
            const field = String(issue.path[0] ?? '');
            found[field] ??=
              field === 'replyToEmail' ? 'Enter a valid email, or leave it empty.' : issue.message;
          }
        }
        setErrors(found);
        if (Object.keys(found).length) return;
        save.mutate(email);
      }}
    >
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <SettingsCard
          title="Sender Identity"
          subtitle="Who your firm's emails come from, and where replies go."
          icon={EnvelopeSimple}
          testId="sender-identity"
        >
          <Input
            label="From Name"
            placeholder={firmName}
            maxLength={80}
            value={form.fromName}
            onChange={(e) => set('fromName', e.target.value)}
          />
          <Input
            label="Reply-To Email"
            type="email"
            placeholder="office@yourfirm.com"
            value={form.replyToEmail}
            error={errors.replyToEmail}
            onChange={(e) => set('replyToEmail', e.target.value)}
          />
          <p className="text-xs text-muted">
            The sending address is your firm&apos;s verified sender; it cannot be typed here.
          </p>
        </SettingsCard>

        <SettingsCard
          title="Email Content"
          subtitle="Added to every email your firm sends to clients."
          icon={ChatText}
          testId="email-content"
        >
          <Textarea
            label="Header"
            rows={2}
            maxLength={500}
            value={form.header}
            onChange={(e) => set('header', e.target.value)}
          />
          <Textarea
            label="Footer"
            rows={3}
            maxLength={1000}
            value={form.footer}
            onChange={(e) => set('footer', e.target.value)}
          />
          <Textarea
            label="Disclaimer"
            rows={3}
            maxLength={2000}
            value={form.disclaimer}
            onChange={(e) => set('disclaimer', e.target.value)}
          />
        </SettingsCard>

        <SettingsCard
          title="Preview"
          subtitle="How a message looks with these settings."
          icon={Eye}
          testId="email-preview"
        >
          <div className="flex flex-col gap-2 rounded-lg border border-divider p-4 text-sm">
            <p>
              <span className="text-muted">From: </span>
              <span className="font-semibold text-heading">{fromName}</span>
            </p>
            <p>
              <span className="text-muted">Reply-To: </span>
              {form.replyToEmail.trim() || 'the sending address'}
            </p>
            <hr className="border-divider" />
            {form.header.trim() ? (
              <p className="font-semibold text-heading">{form.header}</p>
            ) : null}
            <p className="text-text">
              Hello Jamie, your documents are ready to review in the portal.
            </p>
            {form.footer.trim() ? (
              <p className="whitespace-pre-line text-muted">{form.footer}</p>
            ) : null}
            {form.disclaimer.trim() ? (
              <p className="whitespace-pre-line text-xs text-muted">{form.disclaimer}</p>
            ) : null}
          </div>
        </SettingsCard>

        <SettingsCard
          title="Text Messages"
          subtitle="SMS reminders and notices."
          icon={ChatText}
          testId="sms-settings"
        >
          <p className="text-sm text-text">
            Text messages say a message is waiting and never carry a link to documents, a code or
            client data. Each client chooses whether to get them.
          </p>
          <Link
            href={moduleHref('communications')}
            className="text-sm font-semibold text-link hover:underline"
          >
            Open Communications
          </Link>
        </SettingsCard>
      </div>
      <Callout icon={Info} tone="navy" surface="plain" size="compact">
        Your logo on emails follows Branding. Required security and legal notices are always added
        and cannot be removed.
      </Callout>
      {save.error ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
          {errorMessage(save.error, COMMS_ERRORS)}
          {errorCode(save.error) === 'SAVE_CONFLICT' ? (
            <Button variant="secondary" onClick={onReload}>
              Reload
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {saved ? (
          <span role="status" data-testid="communications-saved" className="text-sm text-success">
            {saved}
          </span>
        ) : null}
        <div className="ml-auto flex gap-3">
          <Button
            variant="secondary"
            disabled={save.isPending}
            onClick={() => {
              setForm(fromBranding(branding));
              setErrors({});
              onSaved('');
            }}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            Save Changes
          </Button>
        </div>
      </div>
    </form>
  );
}
