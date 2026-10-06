'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import {
  ApiRequestError,
  PASSWORD_RULES,
  Password,
  type SignInResult,
  type ActivationCheckResponse,
  type MfaSetupResponse,
} from '@firmivra/types';
import { Alert, Button, Card, Icon, Input, Skeleton, type IconName } from '@firmivra/ui';
import { AUTH_MODE, DEV_USERS, adminAuth, staffAuth, signIn } from '../lib/auth';

type Step =
  | { kind: 'sign-in' | 'forgot' | 'reset' | 'activate' }
  | { kind: 'mfa'; session: string }
  | { kind: 'setup'; data: MfaSetupResponse; qr: string };
const errors: Record<string, string> = {
  INVALID_CREDENTIALS: 'Email or password is incorrect.',
  MFA_CODE_INVALID: 'The code is incorrect. Try the latest code from your authenticator.',
  CHALLENGE_EXPIRED: 'Your sign-in session expired. Please sign in again.',
  RATE_LIMITED: 'Too many attempts. Wait a few minutes and try again.',
  INVITE_INVALID: 'This invitation cannot be used. Ask your administrator for a new link.',
  INVITE_EXPIRED: 'This invitation expired. Ask your administrator for a new link.',
  PASSWORD_REJECTED: 'Choose a different password that meets the rules below.',
  RESET_CODE_INVALID: 'This reset code is invalid or expired. Request a new code.',
};
function messageFor(error: unknown) {
  if (error instanceof ApiRequestError)
    return (
      errors[error.code] ??
      (error.status === 404
        ? 'This service is not available yet. Please try again later.'
        : 'We could not complete your request. Please try again.')
    );
  return 'We could not connect. Please try again.';
}

/** Uses Rasel's typed auth helpers. Challenges and MFA secrets stay only in component memory. */
export function StaffAccess({
  site,
  mode = 'sign-in',
  token,
  devTools = false,
}: {
  site: 'firm' | 'admin';
  mode?: 'sign-in' | 'forgot' | 'reset' | 'activate';
  token?: string;
  devTools?: boolean;
}) {
  const router = useRouter();
  const client = site === 'admin' ? adminAuth : staffAuth;
  const [step, setStep] = useState<Step>({ kind: mode });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [invite, setInvite] = useState<ActivationCheckResponse>();
  const [checking, setChecking] = useState(mode === 'activate');
  useEffect(() => {
    if (mode !== 'activate') return;
    let active = true;
    async function check() {
      try {
        if (!token) throw new Error('missing');
        const result = await staffAuth.checkActivation({ token });
        if (active) {
          setInvite(result);
          setName(result.name);
        }
      } catch (e) {
        if (active)
          setError(!token ? 'Open the activation link from your invitation email.' : messageFor(e));
      } finally {
        if (active) setChecking(false);
      }
    }
    void check();
    return () => {
      active = false;
    };
  }, [mode, token]);
  async function next(result: SignInResult) {
    setPassword('');
    setConfirm('');
    setCode('');
    if (result.status === 'SIGNED_IN') {
      router.replace('/');
      router.refresh();
      return;
    }
    if (result.status === 'MFA_REQUIRED') {
      setStep({ kind: 'mfa', session: result.session });
      return;
    }
    const data = await client.startMfaSetup({ session: result.session });
    const qr = await QRCode.toDataURL(data.otpauthUri, { margin: 2, width: 192 });
    setStep({ kind: 'setup', data, qr });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      if (step.kind === 'sign-in') await next(await client.signIn({ email, password }));
      else if (step.kind === 'mfa' || step.kind === 'setup')
        await next(
          await client.submitMfaCode({
            session: step.kind === 'setup' ? step.data.session : step.session,
            code,
          }),
        );
      else if (step.kind === 'forgot') {
        await client.forgotPassword({ email });
        setNotice('If an account matches this email, we sent a reset code.');
        setStep({ kind: 'reset' });
      } else {
        const parsed = Password.safeParse(password);
        if (!parsed.success) {
          setError('Your password must meet every rule below.');
          return;
        }
        if (password !== confirm) {
          setError('The passwords do not match.');
          return;
        }
        if (step.kind === 'activate') {
          if (!invite || !token) return;
          await next(await staffAuth.activate({ token, password, name }));
        } else {
          await client.resetPassword({ email, code, password });
          setNotice('Your password was reset. Sign in with your new password.');
          setStep({ kind: 'sign-in' });
          setPassword('');
          setConfirm('');
        }
      }
    } catch (e) {
      setError(messageFor(e));
      if (e instanceof ApiRequestError && e.code === 'CHALLENGE_EXPIRED')
        setStep({ kind: 'sign-in' });
    } finally {
      setBusy(false);
    }
  }
  async function quick(address: string) {
    setError('');
    setBusy(true);
    try {
      await signIn(address, site === 'admin' ? 'ADMIN' : 'STAFF');
      router.replace('/');
      router.refresh();
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  }
  const heading =
    step.kind === 'mfa'
      ? 'Verify your identity'
      : step.kind === 'setup'
        ? 'Set up your authenticator'
        : step.kind === 'activate'
          ? 'Activate your account'
          : step.kind === 'forgot'
            ? 'Forgot your password?'
            : step.kind === 'reset'
              ? 'Reset your password'
              : 'Welcome Back';
  const newPassword = step.kind === 'activate' || step.kind === 'reset';
  return (
    <main className="ref-login" data-step={step.kind}>
      <div className="ref-office" aria-hidden="true" />
      <section
        className="ref-login-art"
        aria-label={site === 'admin' ? 'Super Admin portal' : 'Firm workspace'}
      >
        <div className="ref-login-copy">
          <Image
            src="/brand/firmivra-login-wordmark.png"
            alt="Firmivra"
            width={388}
            height={154}
            className="ref-login-brand"
            unoptimized
          />
          <p className="ref-portal-label">
            {site === 'admin' ? 'SUPER ADMIN PORTAL' : 'FIRM WORKSPACE'}
          </p>
          <hr />
          <h1>
            Manage. Approve. <span>Grow.</span>
          </h1>
          <p className="ref-login-description">
            {site === 'admin'
              ? 'Access the Firmivra administrative dashboard to manage firms, applications, users, subscriptions and platform settings.'
              : 'Access your Firmivra workspace to manage your team, clients, documents and services.'}
          </p>
          <div className="ref-login-features">
            {(site === 'admin'
              ? [
                  ['firm', 'Manage Firms', 'Review and approve new firm applications.'],
                  ['users', 'Oversee Users', 'Maintain platform access and permissions.'],
                  ['chart', 'Track Growth', 'Monitor subscriptions, usage and performance.'],
                  ['settings', 'Control Settings', 'Manage platform features and configurations.'],
                ]
              : [
                  ['firm', 'Manage Your Firm', 'Keep your team and client work organized.'],
                  ['users', 'Work Together', 'Manage staff access and permissions.'],
                  ['file', 'Stay Organized', 'Access your documents and services.'],
                  ['settings', 'Firm Settings', 'Manage your workspace configuration.'],
                ]
            ).map(([icon, title, description], i) => (
              <div className="ref-login-feature" key={title}>
                <span className={`ref-feature-icon ${i % 2 ? 'teal' : ''}`}>
                  <Icon name={icon as IconName} />
                </span>
                <div>
                  <strong>{title}</strong>
                  <p>{description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="ref-login-card">
        <Image
          src="/brand/firmivra-wordmark.png"
          alt="Firmivra"
          width={367}
          height={132}
          className="ref-card-brand"
          unoptimized
        />
        <p className="ref-card-portal-label">
          {site === 'admin' ? 'SUPER ADMIN PORTAL' : 'FIRM WORKSPACE'}
        </p>
        <hr className="ref-brand-rule" />
        <h2>{heading}</h2>
        <p className="ref-login-subtitle">
          {step.kind === 'sign-in'
            ? site === 'admin'
              ? 'Sign in to access the Firmivra administrative dashboard.'
              : 'Sign in to access your Firmivra workspace.'
            : 'Complete this step to continue securely.'}
        </p>
        {error ? (
          <div className="mt-4">
            <Alert title={error} tone="danger" />
          </div>
        ) : null}
        {notice ? (
          <div className="mt-4">
            <Alert title={notice} />
          </div>
        ) : null}
        {checking ? (
          <div role="status" aria-label="Checking invitation" className="mt-6 space-y-4">
            <Skeleton />
            <Skeleton />
          </div>
        ) : (
          <form onSubmit={submit} className="ref-login-form">
            {step.kind === 'setup' ? (
              <div className="space-y-4">
                <p className="text-sm">
                  Scan this QR code in your authenticator app, then enter the current 6-digit code.
                </p>
                <Image
                  src={step.qr}
                  alt="Authenticator setup QR code"
                  width={192}
                  height={192}
                  unoptimized
                />
                <details>
                  <summary className="text-sm text-link">Enter a setup key instead</summary>
                  <p className="mt-3 break-all font-mono text-sm">{step.data.secret}</p>
                </details>
              </div>
            ) : null}
            {invite && step.kind === 'activate' ? (
              <>
                <p className="text-sm text-muted">
                  {invite.business.name} · {invite.email}
                </p>
                <Input
                  label="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={200}
                />
              </>
            ) : null}
            {['sign-in', 'forgot', 'reset'].includes(step.kind) ? (
              <div className="ref-auth-field">
                <label htmlFor="staff-email">Email Address</label>
                <Icon name="mail" />
                <input
                  id="staff-email"
                  type="email"
                  autoComplete="username"
                  placeholder="Enter your email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  maxLength={254}
                />
              </div>
            ) : null}
            {step.kind === 'mfa' || step.kind === 'setup' || step.kind === 'reset' ? (
              <Input
                label="6-digit code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                required
                hint={AUTH_MODE === 'local' ? 'Local test code: 000000' : 'Use the latest code.'}
              />
            ) : null}
            {step.kind === 'sign-in' || newPassword ? (
              <>
                <div className="ref-auth-field">
                  <label htmlFor="staff-password">
                    {newPassword ? 'New password' : 'Password'}
                  </label>
                  <Icon name="lock" />
                  <input
                    id="staff-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={newPassword ? 'new-password' : 'current-password'}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    maxLength={256}
                  />
                  <button
                    type="button"
                    className="ref-eye"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    <Icon name="eye" />
                  </button>
                </div>
              </>
            ) : null}
            {newPassword ? (
              <>
                <Input
                  label="Confirm new password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  maxLength={256}
                />
                <ul className="space-y-1 text-sm" aria-label="Password rules">
                  {PASSWORD_RULES.map((rule) => (
                    <li
                      key={rule.id}
                      className={rule.test(password) ? 'text-success' : 'text-muted'}
                    >
                      {rule.test(password) ? '✓' : '○'} {rule.label}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {step.kind === 'sign-in' ? (
              <div className="ref-auth-options">
                <label>
                  <input type="checkbox" /> Remember me
                </label>
                <a href="/forgot-password">Forgot password?</a>
              </div>
            ) : null}
            <button
              type="submit"
              aria-busy={busy}
              disabled={busy || (step.kind === 'activate' && !invite)}
              className="ref-login-submit"
            >
              {step.kind === 'sign-in'
                ? 'Sign In'
                : step.kind === 'forgot'
                  ? 'Send reset code'
                  : step.kind === 'reset'
                    ? 'Reset password'
                    : step.kind === 'activate'
                      ? 'Activate account'
                      : 'Verify code'}
              {step.kind === 'sign-in' ? <Icon name="arrow" /> : null}
            </button>
            {step.kind !== 'sign-in' ? (
              <Button
                variant="link"
                className="w-full"
                disabled={busy}
                onClick={() => {
                  setStep({ kind: 'sign-in' });
                  setError('');
                  setPassword('');
                  setConfirm('');
                }}
              >
                Back to sign in
              </Button>
            ) : null}
          </form>
        )}
        <p className="ref-authorized">AUTHORIZED ACCESS ONLY</p>
        <div className="ref-security">
          <Icon name="shield" />
          <p>
            {site === 'admin'
              ? 'This area is for Firmivra authorized personnel only.'
              : 'This area is for authorized firm personnel only.'}
            <br />
            <small>All access is monitored and secured.</small>
          </p>
        </div>
        {AUTH_MODE === 'local' && devTools && step.kind === 'sign-in' ? (
          <div className="ref-local-tools">
            <Card title="Local development">
              <p className="mb-4 text-sm text-muted">
                Synthetic users only. Password: Firmivra-local-1.
              </p>
              <div className="space-y-2">
                {DEV_USERS[site === 'admin' ? 'ADMIN' : 'STAFF'].map((user) => (
                  <Button
                    key={user.email}
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void quick(user.email)}
                    className="w-full"
                  >
                    {user.label} ({user.email})
                  </Button>
                ))}
              </div>
            </Card>
          </div>
        ) : null}
      </section>
    </main>
  );
}
