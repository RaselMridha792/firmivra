import type { ReactNode } from 'react';
import { AuthIcon } from './auth-icon';
const features = {
  admin: [
    ['firm', 'Manage Firms', 'Review and approve new firm applications.'],
    ['users', 'Oversee Users', 'Maintain platform access and permissions.'],
    ['chart', 'Track Growth', 'Monitor subscriptions, usage and performance.'],
    ['settings', 'Control Settings', 'Manage platform features and configurations.'],
  ],
  firm: [
    ['users', 'Serve Clients', 'Keep client details, documents and messages together.'],
    ['firm', 'Run Your Firm', 'Manage your services, appointments and invoices.'],
    ['chart', 'Track Work', 'Follow tasks, requests and intake forms.'],
    ['settings', 'Control Access', 'Give each team member the right access.'],
  ],
} as const;
export function AuthFrame({
  site,
  title,
  subtitle,
  children,
}: {
  site: 'firm' | 'admin';
  title: string;
  /** The line under the title; sign-in and other steps have their own. */
  subtitle?: string;
  children: ReactNode;
}) {
  const portal = site === 'admin' ? 'SUPER ADMIN PORTAL' : 'FIRM WORKSPACE';
  return (
    <main className="auth-screen" data-testid="auth-screen">
      <aside className="auth-art" aria-label={portal}>
        <div className="auth-copy">
          <div className="auth-logo-light" role="img" aria-label="Firmivra" />
          <p className="auth-portal">{portal}</p>
          <hr />
          {/* The platform team approves firms; a firm's staff serve their clients. */}
          <h1>
            {site === 'admin' ? 'Manage. Approve. ' : 'Serve. Organize. '}
            <span>Grow.</span>
          </h1>
          <p className="auth-description">
            {site === 'admin'
              ? 'Access the Firmivra administrative dashboard to manage firms, applications, users, subscriptions and platform settings.'
              : 'Access your Firmivra workspace to manage your team, clients, documents and services.'}
          </p>
          <div className="auth-features">
            {features[site].map(([icon, heading, description], index) => (
              <div className="auth-feature" key={heading}>
                <span aria-hidden="true" className={index % 2 ? 'auth-icon teal' : 'auth-icon'}>
                  <AuthIcon name={icon} />
                </span>
                <div>
                  <strong>{heading}</strong>
                  <p>{description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-logo" role="img" aria-label="Firmivra" />
        <p className="auth-card-portal">{portal}</p>
        <hr />
        <h2 id="auth-title" data-testid="page-title">
          {title}
        </h2>
        <p className="auth-subtitle">
          {subtitle ??
            (title === 'Welcome Back'
              ? `Sign in to access ${site === 'admin' ? 'the Firmivra administrative dashboard' : 'your Firmivra workspace'}.`
              : 'Complete this step to continue securely.')}
        </p>
        {children}
        <p className="auth-authorized">AUTHORIZED ACCESS ONLY</p>
        <div className="auth-security">
          <AuthIcon name="shield" />
          <p>
            This area is for {site === 'admin' ? 'Firmivra authorized' : 'authorized firm'}{' '}
            personnel only.
            <br />
            <small>All access is monitored and secured.</small>
          </p>
        </div>
      </section>
    </main>
  );
}
