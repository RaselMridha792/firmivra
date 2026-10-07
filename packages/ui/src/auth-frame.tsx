import type { ReactNode } from 'react';
import { AuthIcon } from './auth-icon';
const features = [
  ['firm', 'Manage Firms', 'Review and approve new firm applications.'],
  ['users', 'Oversee Users', 'Maintain platform access and permissions.'],
  ['chart', 'Track Growth', 'Monitor subscriptions, usage and performance.'],
  ['settings', 'Control Settings', 'Manage platform features and configurations.'],
] as const;
export function AuthFrame({
  site,
  title,
  children,
}: {
  site: 'firm' | 'admin';
  title: string;
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
          <h1>
            Manage. Approve. <span>Grow.</span>
          </h1>
          <p className="auth-description">
            {site === 'admin'
              ? 'Access the Firmivra administrative dashboard to manage firms, applications, users, subscriptions and platform settings.'
              : 'Access your Firmivra workspace to manage your team, clients, documents and services.'}
          </p>
          <div className="auth-features">
            {features.map(([icon, heading, description], index) => (
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
        <h2 id="auth-title">{title}</h2>
        <p className="auth-subtitle">
          {title === 'Welcome Back'
            ? `Sign in to access ${site === 'admin' ? 'the Firmivra administrative dashboard' : 'your Firmivra workspace'}.`
            : 'Complete this step to continue securely.'}
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
