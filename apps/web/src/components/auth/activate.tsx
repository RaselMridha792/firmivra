'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { type FieldErrors, type Resolver, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ActivateRequest,
  type ActivationCheckResponse,
  type MfaSetupResponse,
  PASSWORD_RULES,
} from '@firmivra/types';
import { AuthFrame, Button, Input } from '@firmivra/ui';
import { ArrowRight, Check, Circle, Eye, EyeOff, LoaderCircle, LockKeyhole } from 'lucide-react';
import { staffAuth } from '../../lib/auth';
import { useApiMutation } from '../../lib/query';
import { errorCode, errorMessage } from '../../lib/errors';
import { Mfa } from './mfa';
import { SignIn } from './sign-in';
import { useAuthReady } from './use-auth-ready';

type Values = { password: string; confirm: string };

/** The API's password rules, plus the confirmation, which only the screen checks. */
const passwordResolver = zodResolver(ActivateRequest.pick({ password: true }));
const resolver: Resolver<Values> = async (values, context, options) => {
  const result = await passwordResolver(values, context, options as never);
  const errors: FieldErrors<Values> = { ...(result.errors as FieldErrors<Values>) };
  if (values.confirm !== values.password) {
    errors.confirm = { type: 'validate', message: 'The passwords do not match' };
  }
  return Object.keys(errors).length > 0 ? { values: {}, errors } : { values, errors: {} };
};

/** Unknown, used, expired or missing links get one answer that never says who has an account. */
const LINK_ERRORS = ['INVITE_INVALID', 'INVITE_EXPIRED', 'VALIDATION_FAILED'];
const ROLES = { OWNER: 'Owner', ADMIN: 'Admin', STAFF: 'Staff' } as const;
/** Button's classes with the screen's main-button look (auth-submit), for a link. */
const SUBMIT_LINK =
  'auth-submit inline-flex items-center justify-center gap-2 px-4 py-2 font-medium text-on-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/** Reads the token from /activate#token=..., then takes it out of the address bar and history. */
function takeToken(): string {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
  const { pathname, search, hash } = window.location;
  if (hash) window.history.replaceState(null, '', pathname + search);
  return token;
}

/**
 * The activation link from an invite email (`/activate#token=...`, docs/api/auth.yaml): check the
 * link, set a password, then the first authenticator setup, as after sign-in. A person who
 * already has a login signs in instead and joins the firm. It never leaves the page by itself.
 */
export function Activate() {
  const ready = useAuthReady();
  const router = useRouter();
  const tokenRef = useRef<string | undefined>(undefined);
  const [show, setShow] = useState(false);
  const [hasLogin, setHasLogin] = useState(false);
  const [linkGone, setLinkGone] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [activated, setActivated] = useState(false);
  const [challenge, setChallenge] = useState<{ session: string; setup?: MfaSetupResponse }>();
  const check = useApiMutation((value: string) => staffAuth.checkActivation({ token: value }));
  const { mutate: checkLink } = check;
  useEffect(() => {
    // Strict Mode runs effects twice: the token is read once, while it is still in the URL.
    if (tokenRef.current !== undefined) return;
    tokenRef.current = takeToken();
    checkLink(tokenRef.current);
  }, [checkLink]);

  const form = useForm<Values>({ resolver, defaultValues: { password: '', confirm: '' } });
  const password = useWatch({ control: form.control, name: 'password' });
  const activate = useApiMutation(async ({ password }: Values) => {
    const result = await staffAuth.activate({ token: tokenRef.current ?? '', password });
    form.reset();
    if (result.status === 'SIGNED_IN') return router.replace('/');
    if (result.status === 'MFA_REQUIRED') return setChallenge({ session: result.session });
    // The link is used up and the password set: if setup can't start now, sign-in starts it.
    const setup = await staffAuth.startMfaSetup({ session: result.session }).catch(() => undefined);
    if (setup) setChallenge({ session: setup.session, setup });
    else setActivated(true);
  });
  // Someone with a login accepts once signed in; a failure is answered here, not on sign-in.
  const join = useApiMutation<void, void>(async () => {
    await staffAuth.acceptInvite({ token: tokenRef.current ?? '' });
    router.replace('/');
  });

  if (challenge) {
    return <Mfa site="firm" {...challenge} onBack={() => router.replace('/sign-in')} />;
  }
  const linkProblem =
    linkGone ||
    (check.isError &&
      !(check.error instanceof TypeError) &&
      LINK_ERRORS.includes(errorCode(check.error) ?? 'VALIDATION_FAILED'));
  const invite = linkProblem ? undefined : check.data;
  if (invite && signingIn && join.isIdle) {
    return (
      <SignIn
        site="firm"
        title="Join your firm"
        email={invite.email}
        onSignedIn={() => join.mutate()}
      >
        <Invitation invite={invite} />
      </SignIn>
    );
  }
  if (activated) {
    return (
      <AuthFrame site="firm" title="Account activated">
        <h1 className="sr-only">Firm workspace</h1>
        <Notice
          id="activation-done"
          role="status"
          title="Your account is activated."
          text="We couldn't start your authenticator setup. Sign in with your new password to finish it."
          href="/sign-in"
          action="Go to sign in"
        />
      </AuthFrame>
    );
  }
  const joining = invite && (invite.hasAccount || hasLogin);
  const joinCode = errorCode(join.error);
  const EyeIcon = show ? EyeOff : Eye;

  return (
    <AuthFrame site="firm" title={joining ? 'Join your firm' : 'Activate your account'}>
      <h1 className="sr-only">Firm workspace</h1>
      {check.isIdle || check.isPending ? (
        <p role="status" className="mt-6 flex items-center justify-center gap-2 text-muted">
          <LoaderCircle
            aria-hidden="true"
            className="size-5 animate-spin motion-reduce:animate-none"
          />
          Checking your invitation link…
        </p>
      ) : null}
      {linkProblem ? (
        <Notice
          id="activation-invalid"
          title="This activation link is not valid."
          text="It may have expired or already been used. Ask the person who invited you for a new link, or sign in if you have already activated your account."
          href="/sign-in"
          action="Go to sign in"
        />
      ) : check.isError ? (
        <div className="mt-6 grid gap-4 text-center">
          <p role="alert" className="text-danger">
            {errorMessage(check.error)}
          </p>
          <Button variant="secondary" onClick={() => checkLink(tokenRef.current ?? '')}>
            Try again
          </Button>
        </div>
      ) : null}
      {invite ? <Invitation invite={invite} /> : null}
      {invite && joining && join.isIdle ? (
        <div className="mt-6 grid gap-6 text-center">
          <p>
            You already have a Firmivra login. Sign in with this email to accept the invitation.
          </p>
          <Button className="auth-submit" onClick={() => setSigningIn(true)}>
            Sign in to accept <ArrowRight aria-hidden="true" className="h-7 w-7" />
          </Button>
        </div>
      ) : null}
      {invite && (join.isPending || join.isSuccess) ? (
        <p role="status" className="mt-6 flex items-center justify-center gap-2 text-muted">
          <LoaderCircle
            aria-hidden="true"
            className="size-5 animate-spin motion-reduce:animate-none"
          />
          Joining {invite.business.name}…
        </p>
      ) : null}
      {invite && join.isError && LINK_ERRORS.includes(joinCode ?? '') ? (
        <Notice
          id="join-failed"
          title="This invitation could not be accepted."
          text="You are signed in, but the invitation may have expired, already been used, or be meant for another login. Ask the person who invited you for a new link."
          href="/"
          action="Go to your workspace"
        />
      ) : invite && join.isError ? (
        <div className="mt-6 grid gap-4 text-center">
          <p role="alert" className="text-danger">
            {errorMessage(join.error)}
          </p>
          {/* A lost session signs in again; anything else tries the accept again. */}
          <Button
            variant="secondary"
            onClick={() => (joinCode === 'UNAUTHENTICATED' ? join.reset() : join.mutate())}
          >
            Try again
          </Button>
        </div>
      ) : null}
      {invite && !joining ? (
        <>
          {activate.isError ? (
            <p role="alert" className="mt-4 text-sm text-danger">
              {errorMessage(activate.error)}
            </p>
          ) : null}
          <form
            data-testid="activate-form"
            className="auth-form"
            noValidate
            onSubmit={form.handleSubmit((values) =>
              activate.mutate(values, {
                onError: (error) => {
                  const code = errorCode(error);
                  setHasLogin(code === 'ACCOUNT_EXISTS');
                  setLinkGone(code === 'INVITE_INVALID' || code === 'INVITE_EXPIRED');
                },
              }),
            )}
          >
            <input type="email" autoComplete="username" value={invite.email} readOnly hidden />
            <fieldset className="contents" disabled={!ready || activate.isPending}>
              {(['password', 'confirm'] as const).map((name) => (
                <div key={name} className="auth-field relative">
                  <Input
                    label={name === 'password' ? 'New password' : 'Confirm password'}
                    type={show ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder={name === 'password' ? 'Create a password' : 'Type it again'}
                    error={form.formState.errors[name]?.message}
                    // Once submitted, a change to the password re-checks the confirmation too.
                    {...form.register(name, name === 'password' ? { deps: 'confirm' } : undefined)}
                  />
                  <LockKeyhole
                    aria-hidden="true"
                    className="pointer-events-none absolute top-12 left-5 h-6 w-6 text-muted"
                  />
                  {name === 'password' ? (
                    <Button
                      className="group absolute top-10 right-2"
                      variant="ghost"
                      aria-label={show ? 'Hide passwords' : 'Show passwords'}
                      aria-pressed={show}
                      onClick={() => setShow(!show)}
                    >
                      <EyeIcon
                        aria-hidden="true"
                        className="h-6 w-6 text-muted group-hover:text-text"
                      />
                    </Button>
                  ) : null}
                </div>
              ))}
              <ul aria-label="Password rules" className="grid gap-1 text-sm sm:grid-cols-2">
                {PASSWORD_RULES.map((rule) => {
                  const met = rule.test(password);
                  const Icon = met ? Check : Circle;
                  return (
                    <li
                      key={rule.id}
                      className={`flex items-center gap-2 ${met ? 'text-success' : 'text-muted'}`}
                    >
                      <Icon aria-hidden="true" className="size-4 shrink-0" />
                      {rule.label}
                      <span className="sr-only">{met ? ', done' : ', not yet'}</span>
                    </li>
                  );
                })}
              </ul>
              <Button
                type="submit"
                className="auth-submit"
                disabled={!ready || activate.isPending}
                aria-busy={activate.isPending}
              >
                Activate account <ArrowRight aria-hidden="true" className="h-7 w-7" />
              </Button>
            </fieldset>
          </form>
        </>
      ) : null}
    </AuthFrame>
  );
}

/**
 * A message with the one way on, as a link in the screen's main-button look. The form it replaces
 * had focus, so the title takes it and screen readers read the message.
 */
function Notice(props: {
  id: string;
  role?: 'alert' | 'status';
  title: string;
  text: string;
  href: string;
  action: string;
}) {
  const titleRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => titleRef.current?.focus(), []);
  return (
    <div className="mt-6 grid gap-6 text-center">
      <div role={props.role ?? 'alert'} data-testid={props.id} className="grid gap-2">
        <p ref={titleRef} tabIndex={-1} className="text-lg font-semibold outline-none">
          {props.title}
        </p>
        <p className="text-muted">{props.text}</p>
      </div>
      <a href={props.href} className={SUBMIT_LINK}>
        {props.action} <ArrowRight aria-hidden="true" className="h-7 w-7" />
      </a>
    </div>
  );
}

/** Who invited this person where, as checkActivation answers. */
function Invitation({ invite }: { invite: ActivationCheckResponse }) {
  return (
    <div
      data-testid="invitation"
      className="mt-6 grid gap-1 rounded-card bg-canvas p-4 text-center"
    >
      <p className="text-lg">
        Welcome, <strong>{invite.name}</strong>
      </p>
      <p className="text-muted">
        You are invited to join <strong className="text-text">{invite.business.name}</strong> as{' '}
        {ROLES[invite.role]}.
      </p>
      <p className="break-words text-sm text-muted">
        Sign-in email: <strong className="text-text">{invite.email}</strong>
      </p>
    </div>
  );
}
