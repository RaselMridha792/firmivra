'use client';

import {
  BEGIN_ONLINE_ERRORS,
  BEGIN_ONLINE_SERVICES,
  EmailResumeLinkRequest,
  resumeTokenFromHash,
} from '@firmivra/types';
import { Button, Card, Input, PageContainer } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../../lib/query';
import { draftKey } from '../../_blocks/intake-flow';

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
      className="bg-surface py-8 text-firm-primary"
    >
      <PageContainer className="flex flex-col items-center">
        <h1 className="text-center font-display text-4xl font-bold text-heading">
          Continue Your <span className="text-accent">Form</span>
        </h1>
        <p className="mt-1 max-w-xl text-center text-sm">
          Your answers are saved securely. Open the link we emailed you to pick up where you left
          off.
        </p>
        <Card className="mt-4 w-full max-w-lg">
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
              <p className="text-sm">Enter your email and we&apos;ll send you a new link.</p>
              <Input
                label="Email Address *"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                error={emailError}
              />
              {link.error && (
                <p role="alert" className="text-sm text-danger">
                  {errorMessage(link.error, BEGIN_ONLINE_ERRORS)}
                </p>
              )}
              <Button type="submit" disabled={link.isPending} className="w-full">
                Email Me My Link
              </Button>
            </form>
          )}
        </Card>
        <Link href={`/${firmSlug}/begin`} className="mt-3 text-sm underline">
          Start a new form
        </Link>
      </PageContainer>
    </div>
  );
}
