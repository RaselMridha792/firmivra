'use client';

import { ESIGN_ERRORS, type EsignTemplateDetail } from '@firmivra/types';
import { Badge, Button, Card, Modal } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { EsignGate } from '../../../../../../../components/esign/esign-gate';
import { canCreate } from '../../../../../../../components/esign/esign-role';
import { roleName, VISIBILITY_LABELS } from '../../../../../../../components/esign/field-labels';
import { FieldOverlay } from '../../../../../../../components/esign/field-overlay';
import { PdfPages } from '../../../../../../../components/esign/pdf-pages';
import { count, shortDate } from '../../../../../../../components/esign/format';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { TEMPLATES, templateKey } from '../../_components/keys';
import { DuplicateTemplate } from './duplicate-template';
import { TemplateDetailsForm } from './template-details-form';
import { TemplateVersions } from './template-versions';

const AUTH: Record<EsignTemplateDetail['roles'][number]['authMethod'], string> = {
  EMAIL_CODE: 'a code sent by email',
  ACCESS_CODE: 'an access code',
  LINK: 'their link only',
};

/** /firm-sign/templates/[id]: what using the template copies, and its owner's controls. */
export function TemplateDetail({ id }: { id: string }) {
  return <EsignGate>{(role) => <Detail id={id} canUse={canCreate(role)} />}</EsignGate>;
}

function Detail({ id, canUse }: { id: string; canUse: boolean }) {
  const template = useApiQuery(templateKey(id), () => api.esign.templates.get(id));
  return <PageState query={template}>{(t) => <Template t={t} canUse={canUse} />}</PageState>;
}

function Template({ t, canUse }: { t: EsignTemplateDetail; canUse: boolean }) {
  const [editing, setEditing] = useState(false);
  const roles = [...t.roles].sort((a, b) => a.routingOrder - b.routingOrder);
  const fields = t.fields.map((f) => ({ ...f, recipientId: f.roleKey, filled: false }));
  const people = t.roles.map((r) => ({ id: r.key, name: roleName(r), colorIndex: r.colorIndex }));
  const { firstAfterDays, everyDays, max } = t.reminders;
  const reminders =
    max === 0
      ? 'Off'
      : max === 1
        ? `Once, after ${count(firstAfterDays, 'day')}`
        : `After ${count(firstAfterDays, 'day')}, then every ${count(everyDays, 'day')}, ${max} in all`;
  const editable = t.canEdit && !t.archivedAt;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Link href="/firm-sign/templates" className="text-sm text-link">
            All templates
          </Link>
          <h1 data-testid="page-title" className="text-3xl font-semibold text-heading">
            {t.name}
          </h1>
          {t.description && <p className="text-muted">{t.description}</p>}
          <div className="flex flex-wrap gap-2">
            <Badge tone={t.visibility === 'FIRM' ? 'info' : 'neutral'}>
              {VISIBILITY_LABELS[t.visibility]}
            </Badge>
            {t.archivedAt && <Badge tone="warning">Archived {shortDate(t.archivedAt)}</Badge>}
          </div>
        </div>
        {!t.archivedAt && (canUse || editable) && (
          <div className="flex flex-wrap gap-3">
            {canUse && (
              <Link
                href={`/firm-sign/new?templateId=${t.id}`}
                className="inline-flex min-h-11 items-center justify-center rounded-control bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                Use template
              </Link>
            )}
            {canUse && <DuplicateTemplate t={t} />}
            {editable && (
              <>
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  Edit details
                </Button>
                <Archive t={t} onArchived={() => setEditing(false)} />
              </>
            )}
          </div>
        )}
      </div>
      {editing && editable && <TemplateDetailsForm t={t} onClose={() => setEditing(false)} />}

      <Card>
        <dl data-testid="template-summary" className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-2">
          {(
            [
              ['Owner', t.owner.name],
              ['Version', `${t.version}, updated ${shortDate(t.updatedAt)}`],
              ['Signing order', t.routing === 'SEQUENTIAL' ? 'One after another' : 'All at once'],
              ['Expires after', count(t.expiryDays, 'day')],
              ['Reminders', reminders],
              ['Email subject', t.emailSubject ?? 'The firm default'],
            ] as const
          ).map(([term, value]) => (
            <div key={term} className="flex gap-2">
              <dt className="text-muted">{term}:</dt>
              <dd className="text-text">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="flex flex-col gap-3">
        <h2 className="font-semibold text-heading">Roles</h2>
        <p className="text-sm text-muted">
          Who fills each role is chosen when the template is used. The client and spouse come from
          the client&apos;s portal logins, the preparer is the person sending.
        </p>
        <ol data-testid="template-roles" className="flex flex-col gap-1 text-sm text-text">
          {roles.map((r) => (
            <li key={r.key}>
              {t.routing === 'SEQUENTIAL' && `${r.routingOrder}. `}
              {roleName(r)} (
              {r.kind === 'SIGNER' ? 'signs' : r.kind === 'APPROVER' ? 'approves' : 'gets a copy'}
              {r.kind === 'SIGNER' && `, checked with ${AUTH[r.authMethod]}`})
            </li>
          ))}
        </ol>
      </Card>

      <TemplateVersions t={t} editable={editable} />

      <section aria-label="Pages" className="flex flex-col gap-3">
        <h2 className="font-semibold text-heading">
          {count(t.pageCount, 'page')}, {count(t.fields.length, 'field')}
        </h2>
        <PdfPages
          source={t.packetUrl}
          label={t.name}
          overlay={(pageIndex) => (
            <FieldOverlay fields={fields} recipients={people} pageIndex={pageIndex} />
          )}
        />
      </section>
    </div>
  );
}

/** Archive behind a confirm: an archived template can't be used again. */
function Archive({ t, onArchived }: { t: EsignTemplateDetail; onArchived: () => void }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const archive = useApiMutation(() => api.esign.templates.archive(t.id), {
    invalidate: TEMPLATES,
  });
  return (
    <>
      <Button
        variant="ghost"
        onClick={() => {
          archive.reset();
          setOpen(true);
        }}
      >
        Archive
      </Button>
      {open && (
        <Modal open title={`Archive ${t.name}?`} onClose={() => setOpen(false)}>
          <div className="flex max-w-xl flex-col gap-4">
            <p className="text-sm text-text">
              No one can start a request from it any more. Requests already made from it keep their
              copy.
            </p>
            {archive.error && (
              <p role="alert" className="text-sm text-danger">
                {errorMessage(archive.error, ESIGN_ERRORS)}
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={archive.isPending}
                onClick={() =>
                  archive.mutate(undefined, {
                    onSuccess: (next) => {
                      queryClient.setQueryData(templateKey(t.id), next);
                      setOpen(false);
                      onArchived();
                    },
                  })
                }
              >
                {archive.isPending ? 'Archiving…' : 'Archive'}
              </Button>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Keep it
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
