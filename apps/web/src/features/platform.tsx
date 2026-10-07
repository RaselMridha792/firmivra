'use client';

import { useState, type ReactNode } from 'react';
import { Alert, EmptyState, Icon, Modal, type IconName } from '@firmivra/ui';
import { useWorkspace } from '../components/workspace-context';
import { LiveApplications, LiveApplicationTable } from './platform-applications';

// Synthetic fixture. Do not use reference contact details as live application data.
const sample = {
  id: 'sample-application',
  firm: 'LVP Accounting & Taxes',
  owner: 'Olivia Holder',
  email: 'olivia@lvp.example',
  phone: '(770) 123-4567',
  status: 'Pending Review',
};
export function ReferenceAction({
  label,
  icon,
  tone = '',
  children,
}: {
  label: string;
  icon?: IconName;
  tone?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`ref-button ${tone}`} onClick={() => setOpen(true)}>
        {icon ? <Icon name={icon} /> : null}
        {label}
      </button>
      <Modal open={open} title={label} onClose={() => setOpen(false)}>
        <div className="space-y-4">
          {children}
          <Alert title="This action is not available yet">
            The service for this action is not connected. No changes have been saved.
          </Alert>
          <button className={`ref-button ${tone}`} disabled>
            {label}
          </button>
        </div>
      </Modal>
    </>
  );
}
function Pagination({ count, kind = 'applications' }: { count: number; kind?: string }) {
  return (
    <div className="ref-pagination">
      <p>
        Showing {count ? '1 of 1' : '0 of 0'} {kind}
      </p>
      <div>
        <button aria-label="Previous page" disabled>
          <Icon name="chevron" />
        </button>
        <button className="current" aria-label="Page 1" aria-current="page">
          1
        </button>
        <button aria-label="Next page" disabled>
          <Icon name="chevron" />
        </button>
      </div>
    </div>
  );
}
export function PlatformSummary({
  firms = false,
  dashboard = false,
  compact = false,
}: {
  firms?: boolean;
  dashboard?: boolean;
  compact?: boolean;
}) {
  const { preview } = useWorkspace();
  const data: {
    label: string;
    count: string;
    icon: IconName;
    color: string;
    link?: string;
    href?: string;
  }[] = dashboard
    ? [
        {
          label: 'Pending Applications',
          count: '1',
          icon: 'file',
          color: '',
          link: 'View Applications',
          href: '/applications',
        },
        {
          label: 'Active Firms',
          count: '0',
          icon: 'firm',
          color: 'green',
          link: 'View Firms',
          href: '/firms',
        },
        {
          label: 'Total Users',
          count: '0',
          icon: 'users',
          color: 'purple',
          link: 'View Users',
          href: '/future/team',
        },
        {
          label: 'Monthly Revenue',
          count: '$0.00',
          icon: 'card',
          color: 'gold',
          link: 'View Billing',
          href: '/future/billing',
        },
      ]
    : firms
      ? [
          {
            label: 'Active Firms',
            count: '1',
            icon: 'firm',
            color: 'green',
            link: 'View Firms',
            href: '/firms',
          },
          {
            label: 'Pending Setup',
            count: '0',
            icon: 'clock',
            color: 'gold',
            link: 'View Pending',
            href: '/firms',
          },
          {
            label: 'Inactive Firms',
            count: '0',
            icon: 'x',
            color: 'red',
            link: 'View Inactive',
            href: '/firms',
          },
          {
            label: 'Total Firms',
            count: '1',
            icon: 'users',
            color: 'purple',
            link: 'View All',
            href: '/firms',
          },
        ]
      : [
          { label: 'Pending Review', count: '1', icon: 'file', color: '' },
          {
            label: compact ? 'Approved' : 'Approved This Month',
            count: '0',
            icon: 'checkCircle',
            color: 'green',
          },
          {
            label: compact ? 'Declined' : 'Declined This Month',
            count: '0',
            icon: 'x',
            color: 'red',
          },
          {
            label: compact ? 'Total This Month' : 'Total Applications',
            count: compact ? '0' : '1',
            icon: 'users',
            color: 'purple',
          },
        ];
  return (
    <div className="ref-summary-grid">
      {data.map((item) => (
        <div className="ref-summary" key={item.label}>
          <span className={`ref-stat-icon ${item.color}`}>
            <Icon name={item.icon} />
          </span>
          <div>
            <strong>{preview ? item.count : '—'}</strong>
            <p>{item.label}</p>
            {item.link ? (
              <a href={`${item.href}${preview ? '?preview=1' : ''}`}>
                {item.link}
                <Icon name="arrow" />
              </a>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
export function ApplicationTable({
  compact = false,
  visible = true,
}: {
  compact?: boolean;
  visible?: boolean;
}) {
  const { preview } = useWorkspace();
  if (!preview) return <LiveApplicationTable compact={compact} />;
  const count = preview && visible ? 1 : 0;
  const widths = compact
    ? {
        sequence: 5,
        name: 15,
        owner: 13,
        email: 18,
        phone: 12,
        submitted: 13,
        status: 12,
        action: 12,
      }
    : {
        selection: 3,
        name: 11,
        type: 10,
        owner: 10,
        email: 14.5,
        services: 12,
        plan: 9,
        submitted: 9,
        status: 11,
        action: 10.5,
      };
  return (
    <>
      <div className="ref-table-region">
        <table className="ref-table" aria-label="Firm applications">
          <colgroup>
            {Object.entries(widths).map(([id, width]) => (
              <col key={id} style={{ width: `${width}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {(compact
                ? [
                    '#',
                    'Business Name',
                    'Owner / Contact',
                    'Email',
                    'Phone',
                    'Submitted',
                    'Status',
                    'Actions',
                  ]
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
                  ]
              ).map((name) => (
                <th key={name || 'select'} scope="col">
                  {name || (
                    <input type="checkbox" aria-label="Select all applications" disabled={!count} />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {count ? (
              <tr>
                <td>
                  {compact ? '1' : <input type="checkbox" aria-label="Select LVP application" />}
                </td>
                <td>
                  <strong>{sample.firm}</strong>
                </td>
                {!compact ? (
                  <td>
                    LLC
                    <br />
                    <small>
                      Tax Preparation,
                      <br />
                      Bookkeeping,
                      <br />
                      Payroll, Business
                      <br />
                      Consulting
                    </small>
                  </td>
                ) : null}
                <td>
                  {sample.owner}
                  {!compact ? (
                    <>
                      <br />
                      <small>{sample.phone}</small>
                    </>
                  ) : null}
                </td>
                <td>{sample.email}</td>
                {compact ? (
                  <td>{sample.phone}</td>
                ) : (
                  <>
                    <td>
                      <ul className="ref-services-list">
                        <li>Tax Preparation</li>
                        <li>Bookkeeping</li>
                        <li>Payroll</li>
                        <li>Business Consulting</li>
                      </ul>
                    </td>
                    <td>
                      Professional
                      <br />
                      (Beta)
                    </td>
                  </>
                )}
                <td>
                  Sep 28, 2026
                  <br />
                  <small>10:24 AM</small>
                </td>
                <td>
                  <span className="ref-status">Pending Review</span>
                </td>
                <td>
                  <a
                    className={`ref-button ${compact ? 'navy' : ''}`}
                    href={`/applications/${sample.id}${preview ? '?preview=1' : ''}`}
                  >
                    Open Application
                  </a>
                </td>
              </tr>
            ) : (
              <tr>
                <td className="ref-empty-row" colSpan={compact ? 8 : 10}>
                  No applications loaded
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination count={count} />
    </>
  );
}
export function Applications({ id }: { id?: string }) {
  const { preview } = useWorkspace();
  return preview ? <PreviewApplications id={id} /> : <LiveApplications id={id} />;
}
function PreviewApplications({ id }: { id?: string }) {
  const { preview } = useWorkspace();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [tab, setTab] = useState('All Applications');
  const visible =
    (!search ||
      `${sample.firm} ${sample.owner} ${sample.email}`
        .toLowerCase()
        .includes(search.toLowerCase())) &&
    (!status || status === sample.status) &&
    ['All Applications', 'Pending'].includes(tab);
  return (
    <div className={id ? 'ref-app-detail-list' : undefined}>
      <div className="ref-page-heading">
        <div>
          <h1>Firm Applications</h1>
          <p>Review and manage new firm applications. Approve firms to activate their accounts.</p>
        </div>
        {id ? (
          <div className="ref-list-tools">
            <label className="ref-search-field">
              <Icon name="search" />
              <input
                aria-label="Search applications"
                placeholder="Search applications by business name, owner, or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <select aria-label="Date Range">
              <option>All Time</option>
            </select>
          </div>
        ) : (
          <ReferenceAction label="Add Firm Manually" icon="plus" />
        )}
      </div>
      <PlatformSummary compact={!!id} />
      <div className={id ? '' : 'ref-panel ref-applications-panel'}>
        {!id ? (
          <>
            <div className="ref-app-tabs" role="group" aria-label="Application status">
              {['All Applications', 'Pending', 'Approved', 'Declined'].map((value) => (
                <button
                  key={value}
                  aria-pressed={tab === value}
                  className={tab === value ? 'is-active' : ''}
                  onClick={() => setTab(value)}
                >
                  {value} ({preview && ['All Applications', 'Pending'].includes(value) ? 1 : 0})
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
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <label className="ref-filter-label">
                Status
                <select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">All Statuses</option>
                  {['Pending Review', 'Info Requested', 'Approved', 'Declined'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label className="ref-filter-label">
                Date Range
                <select>
                  <option>All Time</option>
                </select>
              </label>
            </div>
          </>
        ) : null}
        <ApplicationTable compact={!!id} visible={visible} />
      </div>
      {id ? (
        preview && id === sample.id ? (
          <RecordDetail />
        ) : (
          <EmptyState
            title="Application unavailable"
            description="This application could not be loaded."
          />
        )
      ) : null}
    </div>
  );
}
export function InfoCard({
  title,
  icon,
  rows,
  editable = true,
}: {
  title: string;
  icon: IconName;
  rows: [string, string][];
  editable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="ref-detail-card">
      <h3>
        <Icon name={icon} />
        {title}
        <button disabled={!editable} onClick={() => setOpen(true)}>
          Edit
        </button>
      </h3>
      <table aria-label={title}>
        <tbody>
          {rows.map(([key, value]) => (
            <tr key={key}>
              <td>{key}</td>
              <td className={key === 'Email' ? 'text-link' : ''}>
                {value.split('\n').map((line, i) => (
                  <span key={`${key}:${line}`}>
                    {i ? <br /> : null}
                    {line}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Modal open={open} title={`Edit ${title}`} onClose={() => setOpen(false)}>
        <Alert title="Editing is not available yet">The record has not been changed.</Alert>
      </Modal>
    </section>
  );
}
function NoteCard({ firms }: { firms: boolean }) {
  const [note, setNote] = useState('');
  return (
    <section className="ref-detail-card">
      <h3>
        <Icon name="message" />
        {firms ? 'Notes' : 'Internal Notes'}
      </h3>
      <textarea
        aria-label="Internal notes"
        placeholder={`Add internal notes about this ${firms ? 'firm' : 'application'}...`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="ref-note-footer">
        <p>Notes are only visible to Firmivra administrators.</p>
        <button className="ref-button" disabled>
          Save Note
        </button>
      </div>
    </section>
  );
}
function RecordDetail({ firms = false }: { firms?: boolean }) {
  const { preview } = useWorkspace();
  return (
    <section className="ref-panel ref-record-detail">
      <a
        href={`/${firms ? 'firms' : 'applications'}${preview ? '?preview=1' : ''}`}
        className="ref-back-link"
      >
        <Icon name="back" />
        Back to {firms ? 'Firms' : 'Applications'}
      </a>
      <div className="ref-record-heading">
        <div>
          <h2>{sample.firm}</h2>
          <span className={`ref-status ${firms ? 'active' : ''}`}>
            {firms ? 'Active' : 'Pending Review'}
          </span>
          <p>
            {firms
              ? 'Approved on September 28, 2026 | Professional (Beta)'
              : 'Submitted on September 28, 2026 at 10:24 AM'}
          </p>
        </div>
        <div className="ref-record-actions">
          {firms ? (
            <>
              <ReferenceAction label="Open Firm Workspace" icon="external">
                <p>Entering a firm requires owner-approved support access.</p>
              </ReferenceAction>
              <ReferenceAction label="Edit Firm Details" tone="outline" icon="edit" />
              <ReferenceAction label="Deactivate Firm" tone="red" icon="power" />
            </>
          ) : (
            <>
              <ReferenceAction label="Approve Application" icon="check" tone="green" />
              <ReferenceAction label="Request Information" icon="message" tone="outline" />
              <ReferenceAction label="Decline Application" icon="x" tone="red" />
            </>
          )}
        </div>
      </div>
      <div className="ref-detail-grid">
        <InfoCard
          title="Business Information"
          icon="firm"
          rows={[
            ['Business Name', sample.firm],
            ['Business Type', 'LLC'],
            ['Services Offered', 'Tax Preparation, Bookkeeping,\nPayroll, Business Consulting'],
            ['EIN (if applicable)', '**-***6789'],
            ['Business Address', '123 Business Ave\nLawrenceville, GA 30046'],
          ]}
        />
        <InfoCard
          title="Primary Administrator"
          icon="user"
          rows={[
            ['Full Name', sample.owner],
            ['Email', sample.email],
            ['Phone', sample.phone],
            ['Title / Role', 'Owner'],
            ['Preferred Contact Method', 'Email'],
            ['Alternate Phone', '—'],
          ]}
        />
        <InfoCard
          title="Account Details"
          icon="file"
          rows={
            firms
              ? [
                  ['Plan', 'Professional (Beta)'],
                  ['Team Size (Estimated)', '3'],
                  ['Estimated Client Volume', '500+ (per year)'],
                  ['How They Heard About Us', 'Direct Request'],
                  ['Start Date', 'Sep 28, 2026'],
                  ['Status', 'Active'],
                  ['Additional Information', 'Beta testing for internal use.'],
                ]
              : [
                  ['Requested Plan', 'Professional (Beta)'],
                  ['Estimated Team Size', '3'],
                  ['Estimated Client Volume\n(per year)', '500+'],
                  ['How They Heard About Us', 'Direct Request'],
                  ['Requested Start Date', 'As soon as possible'],
                  ['Additional Information', 'Beta testing for internal use.'],
                ]
          }
        />
        {firms ? (
          <section className="ref-detail-card">
            <h3>
              <Icon name="database" />
              Active Features (Beta)
            </h3>
            <div className="ref-feature-list">
              {[
                'Firm Workspace Access',
                'Client Portal Access',
                'Document Storage',
                'Basic Settings',
              ].map((label) => (
                <div key={label}>
                  <Icon name="checkCircle" />
                  {label}
                  <span className="ref-status active">Active</span>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <section className="ref-detail-card">
            <h3>
              <Icon name="folder" />
              Documents Submitted
            </h3>
            <div className="ref-document-empty">
              <header>
                <span>Document Name</span>
                <span>File</span>
                <span>Uploaded</span>
              </header>
              <p>No documents uploaded.</p>
            </div>
          </section>
        )}
        {firms ? <History firms /> : <NoteCard firms={false} />}
        {firms ? <NoteCard firms /> : <History />}
      </div>
    </section>
  );
}
function History({ firms = false }: { firms?: boolean }) {
  return (
    <section className="ref-detail-card">
      <h3>
        <Icon name="history" />
        {firms ? 'Recent Activity' : 'Application History'}
      </h3>
      {firms ? (
        <div className="ref-history-item">
          <time>
            Sep 28, 2026
            <br />
            10:45 AM
          </time>
          <div>
            <strong>Firm Approved</strong>
            <p>Firm account activated by {sample.owner}.</p>
          </div>
        </div>
      ) : null}
      <div className="ref-history-item">
        <time>
          Sep 28, 2026
          <br />
          10:24 AM
        </time>
        <div>
          <strong>Application Submitted</strong>
          <p>
            Application received from {sample.owner} ({sample.email}).
          </p>
        </div>
      </div>
    </section>
  );
}
export function Firms({ id }: { id?: string }) {
  const { preview } = useWorkspace();
  const [search, setSearch] = useState('');
  const visible =
    preview &&
    `${sample.firm} ${sample.owner} ${sample.email}`.toLowerCase().includes(search.toLowerCase());
  return (
    <div className={id ? 'ref-firm-detail-list' : undefined}>
      <div className="ref-page-heading">
        <div>
          <h1>Firms</h1>
          <p>Manage approved firms and their access to the platform.</p>
        </div>
        <div className="ref-list-tools">
          <label className="ref-search-field">
            <Icon name="search" />
            <input
              aria-label="Search firms"
              placeholder="Search firms by name, owner, or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="ref-search-field">
            <Icon name="filter" />
            <select aria-label="Filter firms">
              <option>Filter</option>
              <option>Active</option>
            </select>
          </label>
          <ReferenceAction label="Add Firm" icon="plus" />
        </div>
      </div>
      <PlatformSummary firms />
      <div className="ref-table-region">
        <table className="ref-table" aria-label="Approved firms">
          <thead>
            <tr>
              {[
                '#',
                'Business Name',
                'Owner / Primary Contact',
                'Email',
                'Phone',
                'Plan',
                'Status',
                'Date Approved',
                'Actions',
              ].map((value) => (
                <th key={value} scope="col">
                  {value}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible ? (
              <tr>
                <td>1</td>
                <td>
                  <strong>{sample.firm}</strong>
                </td>
                <td>{sample.owner}</td>
                <td>{sample.email}</td>
                <td>{sample.phone}</td>
                <td>Professional (Beta)</td>
                <td>
                  <span className="ref-status active">Active</span>
                </td>
                <td>Sep 28, 2026</td>
                <td>
                  <a
                    href={`/firms/sample-firm${preview ? '?preview=1' : ''}`}
                    className="ref-button navy"
                  >
                    Open Firm
                  </a>
                </td>
              </tr>
            ) : (
              <tr>
                <td colSpan={9} className="ref-empty-row">
                  No firms loaded
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination count={visible ? 1 : 0} kind="firms" />
      {id ? (
        preview && id === 'sample-firm' ? (
          <RecordDetail firms />
        ) : (
          <EmptyState
            title="Firm unavailable"
            description="This approved firm could not be loaded."
          />
        )
      ) : null}
    </div>
  );
}
export function FutureModule({ title }: { title: string }) {
  return (
    <>
      <div className="ref-page-heading">
        <div>
          <h1>{title}</h1>
        </div>
      </div>
      <EmptyState
        title="Coming Soon"
        description="This module will be available in a future release."
      />
    </>
  );
}
