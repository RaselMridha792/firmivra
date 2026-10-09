'use client';

import { ESIGN_ERRORS, EsignBulkSendBody, EsignTemplateId } from '@firmivra/types';
import { Button, Card, Checkbox, Input, Select } from '@firmivra/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EsignGate } from '../../../../../../components/esign/esign-gate';
import { canCreate, isFirmManager } from '../../../../../../components/esign/esign-role';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import {
  askedRoles,
  draftOf,
  memberOptions,
  type RoleDraft,
  roleErrorKey,
  TemplateRoles,
  toWho,
} from '../../new/_components/template-roles';
import { TEMPLATES, templateKey } from '../../templates/_components/keys';
import { BatchView } from './batch-view';
import { type Chosen, ClientChecklist } from './client-checklist';

/** /firm-sign/bulk: one template to many clients, a separate request each; ?batch= its progress. */
export function BulkSend({ batchId }: { batchId?: string }) {
  return (
    <EsignGate>
      {(role) =>
        batchId ? (
          <BatchView id={batchId} />
        ) : canCreate(role) ? (
          <BulkForm canListMembers={isFirmManager(role)} />
        ) : (
          <Card>
            <p className="text-text">You can view signature requests, but not send them.</p>
          </Card>
        )
      }
    </EsignGate>
  );
}

/** The bulk send's roles: the client and spouse fill themselves for each client. */
const shared = <T extends { role: string }>(roles: T[]) =>
  roles.filter((r) => r.role !== 'CLIENT' && r.role !== 'SPOUSE');

function BulkForm({ canListMembers }: { canListMembers: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [templateId, setTemplateId] = useState('');
  const [clients, setClients] = useState<Chosen>(() => new Map());
  const [title, setTitle] = useState('');
  const [roles, setRoles] = useState<Record<string, RoleDraft>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  // Set once the batch is accepted: the form stays locked while its page opens.
  const [leaving, setLeaving] = useState(false);
  const templates = useApiQuery([...TEMPLATES, 'list', '', false], () =>
    api.esign.templates.list(),
  );
  const template = useQuery({
    queryKey: templateKey(templateId),
    queryFn: () => api.esign.templates.get(templateId),
    enabled: EsignTemplateId.safeParse(templateId).success,
  });
  const members = useQuery({
    queryKey: ['esign', 'roles'],
    queryFn: () => api.esign.roles.list(),
    enabled: !!templateId && canListMembers,
  });
  const send = useApiMutation((body: EsignBulkSendBody) =>
    api.esign.templates.bulkSend(templateId, body),
  );
  const t = template.data;
  const busy = send.isPending || leaving;
  // Each chosen client's services must be known first, to tell whether one must be picked.
  const checking = [...clients.values()].some((c) => c.services === null);
  const asked = t ? askedRoles(shared(t.roles)) : [];
  /** Any change means the sender confirms again. */
  const changed = () => {
    setConfirmed(false);
    send.reset();
  };

  function submit() {
    if (!templateId) return setErrors({ template: 'Choose a template' });
    if (!t) return;
    const chosen = asked.map((r) => ({ r, who: toWho(draftOf(roles, r, '')) }));
    const given = chosen.flatMap((c) => (c.who ? [{ r: c.r, who: c.who }] : []));
    const next: Record<string, string> = {};
    for (const c of chosen) if (!c.who) next[c.r.key] = 'Choose who';
    const unfiled = [...clients.values()].filter((c) => (c.services ?? 0) > 1 && !c.engagementId);
    if (unfiled.length) {
      next.clients = `Choose the service for ${unfiled.map((c) => c.name).join(', ')}`;
    }
    const parsed = EsignBulkSendBody.safeParse({
      clients: [...clients].map(([clientId, c]) => ({
        clientId,
        ...(c.engagementId && { engagementId: c.engagementId }),
      })),
      ...(title.trim() && { title }),
      roles: given.map((g) => ({ key: g.r.key, who: g.who })),
      confirm: confirmed || undefined,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = roleErrorKey(issue.path, given);
        const first = issue.path[0];
        if (key) next[key] ??= issue.message;
        else if (first === 'confirm') next.confirm ??= 'Tick the box to confirm';
        else if (first === 'title') next.title ??= issue.message;
        else next.clients ??= issue.message;
      }
    }
    setErrors(next);
    if (!parsed.success || Object.keys(next).length) return;
    send.mutate(parsed.data, {
      onSuccess: (batch) => {
        setLeaving(true);
        queryClient.setQueryData(['esign', 'bulk', batch.id], batch);
        void queryClient.invalidateQueries({ queryKey: ['esign', 'requests', 'list'] });
        void queryClient.invalidateQueries({ queryKey: ['esign', 'summary'] });
        router.push(`/firm-sign/bulk?batch=${batch.id}`);
      },
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 data-testid="page-title" className="text-3xl font-semibold text-heading">
        Bulk send
      </h1>
      <Card>
        <form
          noValidate
          className="flex max-w-2xl flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <fieldset disabled={busy} className="flex min-w-0 flex-col gap-6">
            <Select
              label="Template"
              value={templateId}
              error={errors.template}
              onChange={(e) => {
                setTemplateId(e.target.value);
                setRoles({});
                setErrors({});
                changed();
              }}
              options={[
                { value: '', label: 'Choose a template' },
                ...(templates.data?.items ?? []).map((x) => ({ value: x.id, label: x.name })),
              ]}
            />
            {template.isError && (
              <p role="alert" className="text-sm text-danger">
                {errorMessage(template.error, ESIGN_ERRORS)}
              </p>
            )}
            {t && (
              <>
                <TemplateRoles
                  roles={shared(t.roles)}
                  clientId=""
                  drafts={roles}
                  errors={errors}
                  members={memberOptions(members.data)}
                  onChange={(key, draft) => {
                    setRoles((x) => ({ ...x, [key]: draft }));
                    setErrors(({ [key]: _, ...rest }) => rest);
                    changed();
                  }}
                />
                <p className="-mt-3 text-sm text-muted">
                  The client and spouse come from each client&apos;s portal logins. A client without
                  one is not sent, and the results say so.
                </p>
              </>
            )}
            <ClientChecklist
              chosen={clients}
              error={errors.clients}
              onChange={(update, known) => {
                setClients(update);
                if (known) return;
                setErrors(({ clients: _, ...rest }) => rest);
                changed();
              }}
            />
            <Input
              label="Document name (optional)"
              placeholder={t?.name}
              maxLength={200}
              value={title}
              error={errors.title}
              onChange={(e) => {
                setTitle(e.target.value);
                changed();
              }}
            />
            <Checkbox
              label={`Send ${clients.size} separate ${clients.size === 1 ? 'request' : 'requests'} now`}
              checked={confirmed}
              onChange={(e) => {
                setConfirmed(e.target.checked);
                setErrors(({ confirm: _, ...rest }) => rest);
              }}
            />
            {errors.confirm && (
              <p role="alert" className="-mt-4 text-sm text-danger">
                {errors.confirm}
              </p>
            )}
          </fieldset>
          {send.error && (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(send.error, ESIGN_ERRORS)}
            </p>
          )}
          <div>
            <Button type="submit" disabled={busy || checking || (!!templateId && !t)}>
              {busy ? 'Sending…' : checking ? 'Checking clients…' : 'Send'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
