'use client';

import {
  BEGIN_ONLINE_ERRORS,
  BEGIN_ONLINE_SERVICES,
  EmailResumeLinkRequest,
  resumeTokenFromHash,
} from '@firmivra/types';
import { Button, Input, PageContainer } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, LoaderCircle, LockKeyhole, Mail, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../../lib/query';
import { compactInput, SectionPanel } from '../../_blocks/form-blocks';
import { draftKey } from '../../_blocks/intake-flow';

import styles from '../../_blocks/intake-scale.module.css';

/**
 * "Continue your form" (/{firm}/begin/resume#token=...): the link from the resume email. The token
 * is read from the fragment (never sent in a URL), posted once, and the fragment cleared; the
 * saved form then opens. Without a token, or when the link is expired or used, the visitor asks
 * for a new link by email (the answer never says whether the address has a form).
 */
export function ResumeScreen({ firmSlug }: { firmSlug: string }) {
  const client = api.beginOnline(firmSlug);
  const router = useRouter();
  const queryClient = useQueryClient();
  const startedRef = useRef(false);
  const [failure, setFailure] = useState('');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [sent, setSent] = useState(false);
  const resume = useApiMutation((token: string) => client.resume({ token }));
  const link = useApiMutation((body: EmailResumeLinkRequest) => client.emailResumeLink(body));

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const token = resumeTokenFromHash(window.location.hash);
    if (!window.location.hash) return;
    window.history.replaceState(null, '', window.location.pathname);
    if (!token) {
      void Promise.resolve().then(() =>
        setFailure('This link is not complete. Open it again from your email.'),
      );
      return;
    }
    resume.mutate(token, {
      onSuccess: (draft) => {
        queryClient.setQueryData(draftKey(firmSlug, draft.form), draft);
        router.push(`/${firmSlug}/begin/${BEGIN_ONLINE_SERVICES[draft.form].path}`);
      },
      onError: (e) => {
        setFailure(errorMessage(e, BEGIN_ONLINE_ERRORS));
      },
    });
  }, [client, firmSlug, queryClient, resume, router]);

  function ask(event: FormEvent) {
    event.preventDefault();
    const parsed = EmailResumeLinkRequest.safeParse({ email });
    if (!parsed.success) {
      setEmailError(parsed.error.issues[0]?.message ?? 'Enter a valid email address');
      return;
    }
    setEmailError('');
    link.mutate(parsed.data, { onSuccess: () => setSent(true) });
  }

  return (
    <div
      data-theme="begin-online"
      data-testid="begin-resume"
      className={`bg-surface py-4 text-firm-primary ${styles.scale}`}
    >
      {/* Set as the service forms' header and start card (begin/_blocks), so it reads as one of them. */}
      <PageContainer>
        <header className="mb-3 text-center">
          <h1 className="font-display text-3xl leading-tight font-bold text-heading sm:text-5xl">
            Continue Your <span className="text-accent">Form</span>
          </h1>
          <p className="mx-auto mt-1 max-w-2xl text-sm">
            Your answers are saved securely. Open the link we emailed you to pick up where you left
            off.
          </p>
          <div className="mx-auto mt-2 flex max-w-2xl items-center justify-center gap-2 rounded-control bg-folder-surface px-3 py-1 text-sm">
            <LockKeyhole aria-hidden="true" className="size-4 shrink-0" />
            <p>
              This is a <strong>secure and encrypted form.</strong> Your information is protected
              using industry-standard encryption.
            </p>
          </div>
        </header>
        <SectionPanel
          number={1}
          title="Get a New Link"
          subtitle="Enter the email you started your form with and we'll send you a link to continue."
          icon={<Mail className="size-10" strokeWidth={1.5} />}
          className="mx-auto w-full"
        >
          {resume.isPending || resume.isSuccess ? (
            <p role="status" className="flex items-center gap-2 text-sm">
              <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
              Opening your saved form…
            </p>
          ) : sent ? (
            <p role="status" className="flex items-start gap-2 text-sm">
              <MailCheck aria-hidden="true" className="size-5 shrink-0 text-accent" />
              If a saved form matches {email}, we&apos;ve emailed a new link to it. The link opens
              your form where you left off.
            </p>
          ) : (
            <form noValidate onSubmit={ask} className="space-y-3">
              {failure && (
                <p role="alert" className="text-sm text-danger">
                  {failure}
                </p>
              )}
              <div className="[&_label]:text-sm [&_label]:text-firm-primary">
                <Input
                  label="Email Address *"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  error={emailError}
                  className={compactInput}
                />
              </div>
              {link.error && (
                <p role="alert" className="text-sm text-danger">
                  {errorMessage(link.error, BEGIN_ONLINE_ERRORS)}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  href={`/${firmSlug}/begin`}
                  className="inline-flex min-h-11 items-center gap-2 text-sm text-link underline"
                >
                  <ArrowLeft aria-hidden="true" className="size-4" />
                  Start a new form
                </Link>
                <Button type="submit" disabled={link.isPending} className="min-w-40">
                  Email Me My Link
                  <ArrowRight aria-hidden="true" className="size-4" />
                </Button>
              </div>
            </form>
          )}
        </SectionPanel>
      </PageContainer>
    </div>
  );
}
