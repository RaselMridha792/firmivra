'use client';

import {
  AGREEMENT_ERRORS,
  type CreateAgreementRequest,
  type FirmAgreementList,
  type FirmAgreementSummary,
} from '@firmivra/types';
import { Badge, Button, Card, Modal, Select } from '@firmivra/ui';
import { useState } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { AgreementVersionForm } from './agreement-version-form';
import {
  AGREEMENTS,
  agreementKey,
  scopeLabel,
  versionLine,
  VersionText,
} from './agreements-shared';

/**
 * Intake agreements: what a client signs before a Begin Online form or a portal intake is sent.
 * The firm-wide one covers every form; a service can add its own. Owner and Admin (the API
 * answers 403 to staff).
 */
export function IntakeAgreements() {
  const list = useApiQuery(AGREEMENTS, () => api.agreements.list());
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <PageState query={list}>
      {(data) => {
        const open = data.items.find((agreement) => agreement.id === openId);
        return open ? (
          <AgreementDetail summary={open} onBack={() => setOpenId(null)} />
        ) : (
          <AgreementList data={data} onOpen={setOpenId} />
        );
      }}
    </PageState>
  );
}

function AgreementList({
  data,
  onOpen,
}: {
  data: FirmAgreementList;
  onOpen: (id: string) => void;
}) {
  const [serviceId, setServiceId] = useState('');
  const create = useApiMutation((body: CreateAgreementRequest) => api.agreements.create(body), {
    invalidate: AGREEMENTS,
  });
  const make = (body: CreateAgreementRequest) =>
    create.mutate(body, { onSuccess: (created) => onOpen(created.id) });
  const hasFirmWide = data.items.some((a) => a.scope === 'ALL_INTAKES' && !a.archivedAt);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Clients read and sign these before a Begin Online form or a portal intake is sent. The
        firm-wide agreement covers every form; a service can add its own.
      </p>
      {hasFirmWide ? null : (
        <Card title="No firm-wide agreement yet">
          <p className="mb-4 text-sm text-muted">
            Begin Online forms can&apos;t be sent until it has a published version.
          </p>
          <Button onClick={() => make({ scope: 'ALL_INTAKES' })} disabled={create.isPending}>
            Create the firm-wide agreement
          </Button>
        </Card>
      )}
      <ul className="flex flex-col gap-3">
        {data.items.map((agreement) => (
          <li key={agreement.id} data-testid="agreement">
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-text">
                    {agreement.current?.title ?? 'No version yet'}
                  </p>
                  <p className="text-sm text-muted">{scopeLabel(agreement)}</p>
                  <p className="text-sm text-muted">
                    {agreement.current
                      ? `${versionLine(agreement.current)} · ${agreement.versionCount} in all`
                      : 'Write and publish the first version.'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {agreement.archivedAt ? <Badge>Archived</Badge> : null}
                  <Button
                    variant="secondary"
                    aria-label={`Open ${agreement.current?.title ?? scopeLabel(agreement)}`}
                    onClick={() => onOpen(agreement.id)}
                  >
                    Open
                  </Button>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {data.services.length ? (
        <Card title="Add a service agreement">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="sm:flex-1">
              <Select
                label="Service"
                value={serviceId}
                onChange={(event) => setServiceId(event.target.value)}
                options={[
                  { value: '', label: 'Choose a service' },
                  ...data.services.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
            </div>
            <Button
              variant="secondary"
              disabled={!serviceId || create.isPending}
              onClick={() => make({ scope: 'SERVICE', serviceId })}
            >
              Add agreement
            </Button>
          </div>
        </Card>
      ) : null}
      {create.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(create.error, AGREEMENT_ERRORS)}
        </p>
      ) : null}
    </div>
  );
}

function AgreementDetail({
  summary,
  onBack,
}: {
  summary: FirmAgreementSummary;
  onBack: () => void;
}) {
  const detail = useApiQuery(agreementKey(summary.id), () => api.agreements.get(summary.id));
  const [viewing, setViewing] = useState<number | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button variant="ghost" onClick={onBack}>
          ← All agreements
        </Button>
      </div>
      <PageState query={detail}>
        {(agreement) => (
          <>
            <Card title={agreement.current?.title ?? 'No version yet'}>
              <p className="mb-4 text-sm text-muted">
                {scopeLabel(agreement)}
                {agreement.current ? ` · ${versionLine(agreement.current)}` : ''}
              </p>
              {agreement.current ? (
                <VersionText agreementId={agreement.id} version={agreement.current.version} />
              ) : (
                <p className="text-sm text-muted">Write the first version below.</p>
              )}
            </Card>
            {agreement.archivedAt ? (
              <p className="text-sm text-muted">This agreement is archived: no new versions.</p>
            ) : (
              <NextVersion
                key={agreement.current?.version ?? 0}
                agreementId={agreement.id}
                firmWide={agreement.scope === 'ALL_INTAKES'}
                currentVersion={agreement.current?.version ?? null}
              />
            )}
            {agreement.versions.length > 1 ? (
              <Card title="Earlier versions">
                <ul className="flex flex-col gap-2">
                  {agreement.versions.slice(1).map((version) => (
                    <li
                      key={version.version}
                      className="flex flex-wrap items-center justify-between gap-3"
                    >
                      <span className="text-sm text-text">{versionLine(version)}</span>
                      <Button variant="ghost" onClick={() => setViewing(version.version)}>
                        View version {version.version}
                      </Button>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
            <Modal
              open={viewing !== null}
              title={`Version ${viewing ?? ''}`}
              onClose={() => setViewing(null)}
            >
              {viewing !== null ? (
                <VersionText agreementId={agreement.id} version={viewing} />
              ) : null}
            </Modal>
          </>
        )}
      </PageState>
    </div>
  );
}

/** The next version's form, opened on the current version's text and boxes. */
function NextVersion({
  agreementId,
  firmWide,
  currentVersion,
}: {
  agreementId: string;
  firmWide: boolean;
  currentVersion: number | null;
}) {
  const current = useApiQuery(
    [...agreementKey(agreementId), 'version', currentVersion ?? 0],
    async () =>
      currentVersion === null ? null : api.agreements.getVersion(agreementId, currentVersion),
  );
  return (
    <PageState query={current} isEmpty={() => false}>
      {(version) => (
        <AgreementVersionForm agreementId={agreementId} firmWide={firmWide} current={version} />
      )}
    </PageState>
  );
}
