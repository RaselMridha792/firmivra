'use client';

import { useEffect, useState } from 'react';
import {
  ListAdminApplicationsResponse,
  FirmApplicationDetail,
  ListAdminApplicationHistoryResponse,
  type FirmApplicationSummary,
  type FirmApplicationHistory,
} from '@firmivra/types';
import { Alert, Button, EmptyState, Icon, Skeleton } from '@firmivra/ui';
import { platformRequest, workspaceError } from '../lib/workspace-api';
import { InfoCard, PlatformSummary, ReferenceAction } from './platform';

const statuses = {
  PENDING_REVIEW: 'Pending Review',
  INFO_REQUESTED: 'Info Requested',
  APPROVED: 'Approved',
  DECLINED: 'Declined',
};
function date(value: string) {
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function LiveApplicationTable({
  compact = false,
  search = '',
  status = '',
}: {
  compact?: boolean;
  search?: string;
  status?: string;
}) {
  const [items, setItems] = useState<FirmApplicationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cursor, setCursor] = useState('');
  const [next, setNext] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  // A filter change mounts a fresh table in LiveApplications, so cursors cannot cross filter scopes.
  useEffect(() => {
    const abort = new AbortController();
    const query = new URLSearchParams({ limit: compact ? '5' : '25' });
    if (search.trim()) query.set('search', search.trim());
    if (status) query.set('status', status);
    if (cursor) query.set('cursor', cursor);
    platformRequest(`/admin/applications?${query}`, ListAdminApplicationsResponse, abort.signal)
      .then((result) => {
        if (!abort.signal.aborted) {
          setItems((current) => (cursor ? [...current, ...result.items] : result.items));
          setNext(result.nextCursor);
          setError('');
        }
      })
      .catch((cause: unknown) => {
        if (!abort.signal.aborted) {
          setItems([]);
          setNext(null);
          setError(workspaceError(cause));
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [compact, search, status, cursor, revision]);
  const headers = compact
    ? ['#', 'Business Name', 'Owner / Contact', 'Email', 'Phone', 'Submitted', 'Status', 'Actions']
    : [
        '',
        'Business Name',
        'Business Type',
        'Owner / Contact',
        'Email',
        'Services',
        'Requested Plan',
        'Submitted',
        'Status',
        'Action',
      ];
  return (
    <>
      {error ? (
        <Alert tone="danger" title="Applications could not be loaded">
          {error}
          <Button
            variant="link"
            onClick={() => {
              setCursor('');
              setLoading(true);
              setRevision((value) => value + 1);
            }}
          >
            Retry
          </Button>
        </Alert>
      ) : null}
      <div className="ref-table-region">
        <table className="ref-table" aria-label="Firm applications">
          <thead>
            <tr>
              {headers.map((name) => (
                <th key={name || 'selection'} scope="col">
                  {name || <input type="checkbox" aria-label="Select all applications" disabled />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.id}>
                <td>
                  {compact ? (
                    index + 1
                  ) : (
                    <input type="checkbox" aria-label={`Select ${item.legalName}`} disabled />
                  )}
                </td>
                <td>
                  <strong>{item.dbaName || item.legalName}</strong>
                </td>
                {!compact ? <td>—</td> : null}
                <td>{item.contactName}</td>
                <td>{item.contactEmail}</td>
                {compact ? (
                  <td>—</td>
                ) : (
                  <>
                    <td>—</td>
                    <td>—</td>
                  </>
                )}
                <td>{date(item.createdAt)}</td>
                <td>
                  <span className={`ref-status ${item.status === 'APPROVED' ? 'active' : ''}`}>
                    {statuses[item.status]}
                  </span>
                </td>
                <td>
                  <a
                    className={`ref-button ${compact ? 'navy' : ''}`}
                    href={`/applications/${item.id}`}
                  >
                    Open Application
                  </a>
                </td>
              </tr>
            ))}
            {!items.length ? (
              <tr>
                <td colSpan={headers.length} className="ref-empty-row">
                  {loading ? (
                    <Skeleton className="h-20" />
                  ) : error ? (
                    'Applications unavailable'
                  ) : (
                    'No applications match these filters'
                  )}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="ref-pagination">
        <p>{items.length} applications loaded</p>
        {next ? (
          <Button
            disabled={loading}
            onClick={() => {
              setLoading(true);
              setCursor(next);
            }}
          >
            Load more applications
          </Button>
        ) : null}
      </div>
    </>
  );
}

export function LiveApplications({ id }: { id?: string }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [tab, setTab] = useState('');
  return (
    <div className={id ? 'ref-app-detail-list' : undefined}>
      <div className="ref-page-heading">
        <div>
          <h1>Firm Applications</h1>
          <p>Review and manage new firm applications. Approve firms to activate their accounts.</p>
        </div>
        {!id ? <ReferenceAction label="Add Firm Manually" icon="plus" /> : null}
      </div>
      <PlatformSummary compact={!!id} />
      <div className={id ? '' : 'ref-panel ref-applications-panel'}>
        {!id ? (
          <>
            <div className="ref-app-tabs" role="group" aria-label="Application status">
              {[
                ['', 'All Applications'],
                ['PENDING_REVIEW', 'Pending'],
                ['APPROVED', 'Approved'],
                ['DECLINED', 'Declined'],
              ].map(([value, label]) => (
                <button
                  key={label}
                  aria-pressed={tab === value}
                  className={tab === value ? 'is-active' : ''}
                  onClick={() => {
                    setTab(value ?? '');
                    setStatus('');
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="ref-filter-row">
              <label className="ref-search-field">
                <Icon name="search" />
                <input
                  aria-label="Search applications"
                  placeholder="Search by business name, owner, or email..."
                  value={search}
                  maxLength={200}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <label className="ref-filter-label">
                Status
                <select value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value="">All Statuses</option>
                  {Object.entries(statuses).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ref-filter-label">
                Date Range
                <select disabled>
                  <option>All Time</option>
                </select>
              </label>
            </div>
          </>
        ) : null}
        <LiveApplicationTable
          key={`${search}:${status || tab}`}
          compact={!!id}
          search={search}
          status={status || tab}
        />
      </div>
      {id ? <LiveApplicationDetail id={id} /> : null}
    </div>
  );
}
function LiveApplicationDetail({ id }: { id: string }) {
  const [record, setRecord] = useState<FirmApplicationDetail | null>(null);
  const [history, setHistory] = useState<FirmApplicationHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    // Do not display a fixture or a different application when this record is missing.
    platformRequest(
      `/admin/applications/${encodeURIComponent(id)}`,
      FirmApplicationDetail,
      abort.signal,
    )
      .then(async (result) => {
        if (abort.signal.aborted) return;
        setRecord(result);
        setError('');
        try {
          const entries = await platformRequest(
            `/admin/applications/${result.id}/history?limit=25`,
            ListAdminApplicationHistoryResponse,
            abort.signal,
          );
          if (!abort.signal.aborted) {
            setHistory(entries.items);
            setHistoryError(entries.nextCursor ? 'Showing the latest 25 history entries.' : '');
          }
        } catch (cause) {
          if (!abort.signal.aborted) {
            setHistory([]);
            setHistoryError(workspaceError(cause));
          }
        }
      })
      .catch((cause: unknown) => {
        if (!abort.signal.aborted) {
          setRecord(null);
          setError(workspaceError(cause));
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [id, revision]);
  if (loading) return <Skeleton className="mt-6 h-96" />;
  if (!record)
    return (
      <Alert tone="danger" title="Application unavailable">
        {error}
        <Button
          variant="link"
          onClick={() => {
            setLoading(true);
            setRevision((value) => value + 1);
          }}
        >
          Retry
        </Button>
      </Alert>
    );
  const form = record.form;
  const address = [
    form.addressLine1,
    form.addressLine2,
    [form.city, form.state, form.postalCode].filter(Boolean).join(', '),
    form.country,
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <section className="ref-panel ref-record-detail">
      <a href="/applications" className="ref-back-link">
        <Icon name="back" />
        Back to Applications
      </a>
      <div className="ref-record-heading">
        <div>
          <h2>{record.dbaName || record.legalName}</h2>
          <span className={`ref-status ${record.status === 'APPROVED' ? 'active' : ''}`}>
            {statuses[record.status]}
          </span>
          <p>Submitted on {date(record.createdAt)}</p>
        </div>
        <div className="ref-record-actions">
          <ReferenceAction label="Approve Application" icon="check" tone="green" />
          <ReferenceAction label="Request Information" icon="message" tone="outline" />
          <ReferenceAction label="Decline Application" icon="x" tone="red" />
        </div>
      </div>
      <div className="ref-detail-grid">
        <InfoCard
          editable={false}
          title="Business Information"
          icon="firm"
          rows={[
            ['Business Name', record.legalName],
            ['DBA / Display Name', record.dbaName ?? '—'],
            ['Business Type', '—'],
            ['Services Offered', '—'],
            ['EIN (if applicable)', 'Protected'],
            ['Business Address', address || '—'],
            ['Website', form.website ?? '—'],
          ]}
        />
        <InfoCard
          editable={false}
          title="Primary Administrator"
          icon="user"
          rows={[
            ['Full Name', record.contactName],
            ['Email', record.contactEmail],
            ['Phone', record.contactPhone ?? '—'],
            ['Title / Role', '—'],
            ['Preferred Contact Method', '—'],
            ['Alternate Phone', '—'],
          ]}
        />
        <InfoCard
          editable={false}
          title="Account Details"
          icon="file"
          rows={[
            ['Requested Plan', '—'],
            ['Estimated Team Size', '—'],
            ['Estimated Client Volume', '—'],
            ['Status', statuses[record.status]],
            ['Reviewed', record.reviewedAt ? date(record.reviewedAt) : '—'],
            ['Decision Reason', record.decisionReason ?? '—'],
          ]}
        />
        <section className="ref-detail-card">
          <h3>
            <Icon name="folder" />
            Documents Submitted
          </h3>
          <EmptyState
            title="Documents unavailable"
            description="The file-list integration is not available yet."
          />
        </section>
        <section className="ref-detail-card">
          <h3>
            <Icon name="message" />
            Internal Notes
          </h3>
          <textarea aria-label="Internal notes" value={record.internalNotes ?? ''} readOnly />
          <div className="ref-note-footer">
            <p>Notes are only visible to Firmivra administrators.</p>
            <button className="ref-button" disabled>
              Save Note
            </button>
          </div>
        </section>
        <section className="ref-detail-card">
          <h3>
            <Icon name="history" />
            Application History
          </h3>
          {historyError ? <Alert title="History">{historyError}</Alert> : null}
          {history.map((entry) => (
            <div key={entry.id} className="ref-history-item">
              <time>{date(entry.createdAt)}</time>
              <div>
                <strong>{statuses[entry.toStatus]}</strong>
                <p>{entry.reason ?? 'Status updated'}</p>
              </div>
            </div>
          ))}
          {!history.length && !historyError ? <p>No history recorded.</p> : null}
        </section>
      </div>
    </section>
  );
}
