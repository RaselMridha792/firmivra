'use client';

import { useState } from 'react';
import { Icon, type IconName } from '@firmivra/ui';
import { useWorkspace } from '../components/workspace-context';
import { PlatformSummary } from './platform';

const modules: { name: string; icon: IconName; color: string; href: string }[] = [
  { name: 'Sales', icon: 'chart', color: '', href: '/future/sales' },
  { name: 'Leads / CRM', icon: 'user', color: 'cyan', href: '/future/leads-crm' },
  { name: 'Team Management', icon: 'users', color: 'purple', href: '/future/team' },
  { name: 'Subscriptions', icon: 'card', color: 'pink', href: '/future/subscriptions' },
  { name: 'Billing', icon: 'file', color: 'pink', href: '/future/billing' },
  { name: 'Support', icon: 'headset', color: 'green', href: '/future/support' },
  { name: 'Reports & Analytics', icon: 'chart', color: 'cyan', href: '/future/reports' },
  { name: 'Audit & Security', icon: 'shield', color: 'cyan', href: '/future/audit' },
];
export function PlatformDashboard() {
  const { preview, me } = useWorkspace();
  const [today] = useState(() => new Date());
  const href = (path: string) => `${path}${preview ? '?preview=1' : ''}`;
  return (
    <>
      <div className="ref-dashboard-heading">
        <div>
          <h1>Welcome back, {preview ? 'Olivia' : me.user.name.split(' ')[0]}!</h1>
          <p>Here’s an overview of your Firmivra platform.</p>
        </div>
        <span>
          <Icon name="calendar" />
          {preview
            ? 'Monday, September 28, 2026'
            : new Intl.DateTimeFormat('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              }).format(today)}
        </span>
      </div>
      <PlatformSummary dashboard />
      <div className="ref-dashboard-grid">
        <div className="ref-dashboard-left">
          <section className="ref-panel ref-recent-applications">
            <h2>
              <Icon name="file" />
              Recent Firm Applications
              <a href={href('/applications')}>
                View All <Icon name="arrow" />
              </a>
            </h2>
            <div className="ref-table-region">
              <table className="ref-table" aria-label="Recent firm applications">
                <thead>
                  <tr>
                    {[
                      'Business Name',
                      'Owner / Contact',
                      'Email',
                      'Submitted',
                      'Status',
                      'Actions',
                    ].map((label) => (
                      <th scope="col" key={label}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview ? (
                    <tr>
                      <td>
                        <strong>LVP Accounting & Taxes</strong>
                      </td>
                      <td>Olivia Holder</td>
                      <td>olivia@lvp.example</td>
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
                          href={href('/applications/sample-application')}
                          className="ref-button navy"
                        >
                          Review
                        </a>
                      </td>
                    </tr>
                  ) : (
                    <tr>
                      <td colSpan={6} className="ref-empty-row">
                        No applications loaded
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <div className="ref-dashboard-middle">
            <section className="ref-panel ref-growth">
              <h2>
                <Icon name="chart" />
                Platform Growth <small>(Beta)</small>
                <select aria-label="Growth date range">
                  <option>Last 30 Days</option>
                </select>
              </h2>
              <svg
                viewBox="0 0 400 175"
                role="img"
                aria-label={
                  preview
                    ? 'Example platform growth chart: zero activity'
                    : 'Growth chart, data unavailable'
                }
              >
                <g className="ref-chart-grid">
                  {[0, 1, 2, 3, 4].map((n) => (
                    <line key={n} x1="30" x2="382" y1={145 - n * 28} y2={145 - n * 28} />
                  ))}
                  {[30, 113, 196, 279, 362].map((x) => (
                    <line key={x} x1={x} x2={x} y1="33" y2="145" />
                  ))}
                </g>
                <g className="ref-chart-labels">
                  {[0, 1, 2, 3, 4].map((n) => (
                    <text key={n} x="9" y={149 - n * 28}>
                      {n}
                    </text>
                  ))}
                  {['Sep 1', 'Sep 8', 'Sep 15', 'Sep 22', 'Sep 28'].map((label, i) => (
                    <text key={label} x={30 + i * 83} y="171" textAnchor="middle">
                      {label}
                    </text>
                  ))}
                </g>
                {preview ? (
                  <g className="ref-chart-series">
                    <path d="M30 145H362" />
                    {[30, 113, 196, 279, 362].map((x) => (
                      <circle key={x} cx={x} cy="145" r="3.5" />
                    ))}
                  </g>
                ) : null}
              </svg>
              <div className="ref-chart-legend">
                <span>Applications</span>
                <span>Active Firms</span>
                <span>Revenue</span>
              </div>
            </section>
            <section className="ref-panel ref-attention">
              <h2>
                <Icon name="checkCircle" />
                Tasks Requiring Attention
              </h2>
              {(
                [
                  ['file', 'Firm application pending review', '1', '/applications'],
                  ['warning', 'Payment issues', '0', '/future/billing'],
                  ['headset', 'Open support tickets', '0', '/future/support'],
                  ['users', 'New users this week', '0', '/future/team'],
                  ['chart', 'Renewals this week', '0', '/future/subscriptions'],
                ] as [IconName, string, string, string][]
              ).map(([icon, label, count, path], i) => (
                <a className={`ref-task-row ref-task-${i}`} key={label} href={href(path)}>
                  <span>
                    <Icon name={icon} />
                  </span>
                  <strong>{preview ? count : '—'}</strong>
                  <p>{label}</p>
                  <Icon name="chevron" />
                </a>
              ))}
            </section>
          </div>
        </div>
        <div className="ref-dashboard-right">
          <section className="ref-panel ref-quick-actions">
            <h2>
              <Icon name="bolt" />
              Quick Actions
            </h2>
            {(
              [
                ['file', 'View Firm Applications', '/applications', ''],
                ['firm', 'View Firms', '/firms', 'green'],
                ['settings', 'Platform Settings', '/future/settings', 'purple'],
              ] as [IconName, string, string, string][]
            ).map(([icon, label, path, color]) => (
              <a className={`ref-quick-link ${color}`} key={label} href={href(path)}>
                <Icon name={icon} />
                {label}
                <Icon name="chevron" />
              </a>
            ))}
          </section>
          <section className="ref-panel ref-system-status">
            <h2>
              <Icon name="database" />
              System Status
            </h2>
            {['Platform', 'Database', 'File Storage', 'Email Service', 'Client Portals'].map(
              (label) => (
                <div key={label}>
                  <i className={preview ? 'online' : ''} />
                  <span>{label}</span>
                  <strong>{preview ? 'Online' : 'Unknown'}</strong>
                </div>
              ),
            )}
          </section>
        </div>
      </div>
      <section className="ref-panel ref-platform-modules">
        <h2>
          <Icon name="grid" />
          Platform Modules
        </h2>
        <div>
          {modules.map((item) => (
            <a key={item.name} href={href(item.href)}>
              <span className={`ref-stat-icon ${item.color}`}>
                <Icon name={item.icon} />
              </span>
              <p>
                <strong>{item.name}</strong>
                <small>Coming Soon</small>
              </p>
              <Icon name="chevron" />
            </a>
          ))}
        </div>
      </section>
    </>
  );
}
