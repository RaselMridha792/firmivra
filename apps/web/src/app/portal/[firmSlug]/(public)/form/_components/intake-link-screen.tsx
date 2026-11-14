'use client';

import { INTAKE_LINK_ERRORS, type LinkIntake, resumeTokenFromHash } from '@firmivra/types';
import { Card, PageContainer } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, LockKeyhole } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import {
  type IntakeSource,
  IntakeForm,
} from '../../../(client)/(tabs)/intake/_components/assigned-intake';
import { usePortal } from '../../../layout';

const linkKey = (slug: string) => ['portal', slug, 'intake-link'] as const;

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

/**
 * A lead's secure intake link (/{firm}/form#token=..., Intake Forms Review Two, ACCESS-01): the
 * form the firm emailed, without a portal account. The token is read from the fragment (never
 * sent in a URL), posted once for this browser's cookie, and the fragment cleared; a reload reads
 * the form from the cookie. The lead fills it step by step with the portal's own form (each step
 * saves as it is left), adds files to its upload fields, signs and submits; once sent it reads
 * back without editing. An unknown, replaced or expired link says to ask the firm for a new one.
 */
export function IntakeLinkScreen({ firmSlug }: { firmSlug: string }) {
  const client = useMemo(() => api.intakeLink(firmSlug), [firmSlug]);
  const queryClient = useQueryClient();
  const startedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState('');
  const open = useApiMutation((token: string) => client.open(token));

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const hash = window.location.hash;
    const token = resumeTokenFromHash(hash);
    if (hash) window.history.replaceState(null, '', window.location.pathname);
    if (!token) {
      // No token: a reload reads the form from this browser's cookie, if it has one.
      void Promise.resolve().then(() =>
        hash
          ? setFailure('This link is not complete. Open it again from your email.')
          : setReady(true),
      );
      return;
    }
    open.mutate(token, {
      onSuccess: (intake) => {
        queryClient.setQueryData(linkKey(firmSlug), intake);
        setReady(true);
      },
      onError: (e) => setFailure(errorMessage(e, INTAKE_LINK_ERRORS)),
    });
  }, [firmSlug, open, queryClient]);

  return (
    <div data-theme="begin-online" data-testid="intake-link" className="bg-surface py-4">
      <PageContainer>
        {failure ? (
          <Problem text={failure} />
        ) : ready ? (
          <LinkForm firmSlug={firmSlug} />
        ) : (
          <Opening />
        )}
      </PageContainer>
    </div>
  );
}

function Opening() {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-text">
      <LoaderCircle aria-hidden className="size-5 animate-spin" />
      Opening your form…
    </p>
  );
}

function Problem({ text }: { text: string }) {
  return (
    <Card className="mx-auto grid max-w-2xl gap-2" data-testid="intake-link-problem">
      <h1 className="font-display text-2xl font-bold text-heading">
        This link can&apos;t be opened
      </h1>
      <p role="alert" className="text-text">
        {text}
      </p>
    </Card>
  );
}

function LinkForm({ firmSlug }: { firmSlug: string }) {
  const client = useMemo(() => api.intakeLink(firmSlug), [firmSlug]);
  const { business } = usePortal();
  const intake = useApiQuery(linkKey(firmSlug), () => client.get());
  const expiresAt = intake.data?.expiresAt;
  const source = useMemo<IntakeSource>(
    () => ({
      key: linkKey(firmSlug),
      get: () => client.get(),
      saveStep: (step, body) => client.saveStep(step, body),
      submit: (body) => client.submit(body),
      agreementsKey: [...linkKey(firmSlug), 'agreements'],
      agreements: () => client.agreements(),
      // Leads item n: files in the form's upload fields, through this link's cookie.
      createUpload: (body) => client.createUpload(body),
      confirmUpload: (body) => client.confirmUpload(body),
      removeUpload: (uploadId) => client.removeUpload(uploadId),
      laterNotice: expiresAt
        ? `Your answers are saved. Open the link in your email again before ${day(expiresAt)} to finish and submit.`
        : 'Your answers are saved. Open the link in your email again to finish and submit.',
    }),
    [client, firmSlug, expiresAt],
  );

  if (intake.isPending) return <Opening />;
  if (intake.isError) return <Problem text={errorMessage(intake.error, INTAKE_LINK_ERRORS)} />;
  const found: LinkIntake = intake.data;
  return (
    <div className="grid min-w-0 gap-3">
      <p className="flex items-start gap-2 rounded-control bg-folder-surface px-3 py-2 text-sm text-text">
        <LockKeyhole aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          Hi {found.firstName}, {business.name} sent you this form through a secure link. It works
          until {day(found.expiresAt)}.
        </span>
      </p>
      <IntakeForm slug={firmSlug} intake={found} source={source} />
    </div>
  );
}
