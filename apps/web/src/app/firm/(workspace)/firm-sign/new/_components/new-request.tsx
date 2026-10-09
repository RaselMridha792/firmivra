'use client';

import {
  ClientId,
  CreateEsignRequestBody,
  ESIGN_ERRORS,
  EsignTemplateId,
  type EsignRequestDetail,
  UseEsignTemplateBody,
} from '@firmivra/types';
import { Button, Card, Input, Select } from '@firmivra/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { EsignGate } from '../../../../../../components/esign/esign-gate';
import { canCreate, isFirmManager } from '../../../../../../components/esign/esign-role';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { requestKey } from '../../requests/[id]/prepare/_components/steps';
import { ClientPicker } from './client-picker';
import { TEMPLATES, templateKey } from '../../templates/_components/keys';
import {
  askedRoles,
  draftOf,
  memberOptions,
  type RoleDraft,
  roleErrorKey,
  TemplateRoles,
  toWho,
} from './template-roles';

/** Step 0 of a request (/firm-sign/new): its name, client and service; then the wizard. */
export function NewRequest({ clientId, templateId }: { clientId?: string; templateId?: string }) {
  return (
    <EsignGate>
      {(role) =>
        canCreate(role) ? (
          <StartForm
            fromClient={ClientId.safeParse(clientId).success ? clientId : undefined}
            fromTemplate={EsignTemplateId.safeParse(templateId).success ? templateId : undefined}
            canListMembers={isFirmManager(role)}
          />
        ) : (
          <Card>
            <p className="text-text">You can view signature requests, but not send them.</p>
          </Card>
        )
      }
    </EsignGate>
  );
}

function StartForm({
  fromClient,
  fromTemplate,
  canListMembers,
}: {
  fromClient?: string;
  fromTemplate?: string;
  canListMembers: boolean;
}) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState(fromTemplate ?? '');
  const [roles, setRoles] = useState<Record<string, RoleDraft>>({});
  const [roleErrors, setRoleErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const templates = useApiQuery([...TEMPLATES, 'list', '', false], () =>
    api.esign.templates.list(),
  );
  const template = useQuery({
    queryKey: templateKey(templateId),
    queryFn: () => api.esign.templates.get(templateId),
    enabled: !!templateId,
  });
  const members = useQuery({
    queryKey: ['esign', 'roles'],
    queryFn: () => api.esign.roles.list(),
    enabled: !!templateId && canListMembers,
  });
  const [title, setTitle] = useState('');
  const [clientId, setClientId] = useState(fromClient ?? '');
  const [engagementId, setEngagementId] = useState('');
  const [titleError, setTitleError] = useState<string>();
  const services = useQuery({
    queryKey: ['engagements', clientId],
    queryFn: () => api.engagements.listForClient(clientId),
    enabled: !!clientId,
  });
  const open = (services.data ?? []).filter((e) => ['PENDING', 'ACTIVE'].includes(e.status));
  const queryClient = useQueryClient();
  const create = useApiMutation((body: CreateEsignRequestBody) => api.esign.create(body));
  const use = useApiMutation((body: UseEsignTemplateBody) =>
    api.esign.templates.use(templateId, body),
  );
  const pending = create.isPending || use.isPending;
  const error = create.error ?? use.error;

  function opened(r: EsignRequestDetail) {
    // The wizard opens on the draft just made; the lists and counters catch up behind it.
    queryClient.setQueryData(requestKey(r.id), r);
    void queryClient.invalidateQueries({ queryKey: ['esign', 'requests', 'list'] });
    void queryClient.invalidateQueries({ queryKey: ['esign', 'summary'] });
    router.push(`/firm-sign/requests/${r.id}/prepare`);
  }

  function fromTemplateSubmit() {
    const t = template.data;
    if (!t || t.archivedAt) return;
    const chosen = askedRoles(t.roles).map((r) => ({ r, who: toWho(draftOf(roles, r, clientId)) }));
    const missing = Object.fromEntries(
      chosen.filter((c) => c.who === null).map((c) => [c.r.key, 'Choose who']),
    );
    if (Object.keys(missing).length) return setRoleErrors(missing);
    const given = chosen.filter((c) => c.who);
    const parsed = UseEsignTemplateBody.safeParse({
      ...(title.trim() && { title }),
      ...(clientId && { clientId }),
      ...(engagementId && { engagementId }),
      roles: given.map((c) => ({ key: c.r.key, who: c.who })),
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = roleErrorKey(issue.path, given);
        if (key) next[key] ??= issue.message;
        else if (issue.path[0] === 'title') setTitleError(issue.message);
        else setFormError(issue.message);
      }
      return setRoleErrors(next);
    }
    use.mutate(parsed.data, { onSuccess: opened });
  }

  function submit() {
    setTitleError(undefined);
    setFormError(undefined);
    setRoleErrors({});
    create.reset();
    use.reset();
    if (templateId) return fromTemplateSubmit();
    const parsed = CreateEsignRequestBody.safeParse({
      title,
      source: fromClient && clientId === fromClient ? 'CLIENT_RECORD' : 'TAB',
      ...(clientId && { clientId }),
      ...(engagementId && { engagementId }),
    });
    if (!parsed.success) {
      setTitleError(parsed.error.issues[0]?.message);
      return;
    }
    create.mutate(parsed.data, { onSuccess: opened });
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 data-testid="page-title" className="font-display text-3xl text-heading">
        New signature request
      </h1>
      <Card>
        <form
          noValidate
          className="flex max-w-xl flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Select
            label="Start from"
            value={templateId}
            onChange={(e) => {
              setTemplateId(e.target.value);
              setRoles({});
              setRoleErrors({});
              use.reset();
            }}
            options={[
              { value: '', label: 'My own documents' },
              ...(templates.data?.items ?? []).map((t) => ({
                value: t.id,
                label: `Template: ${t.name}`,
              })),
              // A template from the link that the list doesn't offer (yet) still shows.
              ...(templateId && !templates.data?.items.some((t) => t.id === templateId)
                ? [
                    {
                      value: templateId,
                      label: `Template: ${template.data?.name ?? (template.isError ? 'not available' : 'loading…')}`,
                    },
                  ]
                : []),
            ]}
          />
          <Input
            label={templateId ? 'Document name (optional)' : 'Document name'}
            placeholder={template.data?.name}
            maxLength={200}
            value={title}
            error={titleError}
            onChange={(e) => setTitle(e.target.value)}
          />
          <ClientPicker
            value={clientId}
            fromClient={fromClient}
            onChange={(id) => {
              setClientId(id);
              setEngagementId('');
            }}
          />
          {clientId && (
            <Select
              label="Service (optional)"
              value={engagementId}
              onChange={(e) => setEngagementId(e.target.value)}
              options={[
                { value: '', label: 'Not for a particular service' },
                ...open.map((e) => ({ value: e.id, label: e.title })),
              ]}
            />
          )}
          {templateId && template.data && (
            <TemplateRoles
              roles={template.data.roles}
              clientId={clientId}
              drafts={roles}
              errors={roleErrors}
              members={memberOptions(members.data)}
              onChange={(key, draft) => {
                setRoles((x) => ({ ...x, [key]: draft }));
                setRoleErrors(({ [key]: _, ...rest }) => rest);
              }}
            />
          )}
          {templateId && (template.isError || template.data?.archivedAt) && (
            <p role="alert" className="text-sm text-danger">
              {template.data?.archivedAt
                ? ESIGN_ERRORS.TEMPLATE_ARCHIVED
                : errorMessage(template.error, ESIGN_ERRORS)}
            </p>
          )}
          <p className="text-sm text-muted">
            {templateId
              ? "The template's documents, fields and settings are copied; the template itself doesn't change. Next you check them and send."
              : "The signed copy is filed in the client's documents. Next you add the documents and the people who sign."}
          </p>
          {(formError || error) && (
            <p role="alert" className="text-sm text-danger">
              {formError ?? errorMessage(error, ESIGN_ERRORS)}
            </p>
          )}
          <div>
            <Button
              type="submit"
              disabled={pending || (!!templateId && (!template.data || !!template.data.archivedAt))}
            >
              Continue
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
