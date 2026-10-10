'use client';

import type { SignUpState } from '@firmivra/types';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { portalAuth } from '../../../../../../lib/auth';
import { errorCode } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';

/** The page each sign-up step lives on. CONTACT_FIRM shows on the page the person is on. */
export const stepPath = (slug: string, step: SignUpState['step']): string | null =>
  ({
    VERIFY_EMAIL: `/${slug}/sign-up/verify-email`,
    VERIFY_PHONE: `/${slug}/sign-up/verify-phone`,
    DONE: `/${slug}/sign-up/done`,
    CONTACT_FIRM: null,
  })[step];

/**
 * Where the sign-up stands (the sealed sign-up cookie: the pages store nothing), and a mutation
 * helper for the step's calls. After a call the page follows the answer's `step`; an expired
 * sign-up (410 SIGN_UP_EXPIRED) goes back to /sign-up. Opening a page never navigates by itself.
 */
export function useSignUpState(slug: string) {
  const key = ['sign-up-state', slug];
  const client = useQueryClient();
  const router = useRouter();
  const state = useApiQuery(key, () => portalAuth(slug).signUpState());
  const action = useApiMutation((call: () => Promise<SignUpState>) => call());
  const run = (call: () => Promise<SignUpState>, onDone?: (next: SignUpState) => void) =>
    action.mutate(call, {
      onSuccess: (next) => {
        const before = client.getQueryData<SignUpState>(key)?.step;
        client.setQueryData(key, next);
        onDone?.(next);
        const path = stepPath(slug, next.step);
        if (next.step !== before && path) router.push(path);
      },
      onError: (error) => {
        if (errorCode(error) === 'SIGN_UP_EXPIRED') router.push(`/${slug}/sign-up`);
        // A wrong code can end the sign-up at CONTACT_FIRM: read where it stands now.
        else void client.invalidateQueries({ queryKey: key });
      },
    });
  return { state, action, run };
}
