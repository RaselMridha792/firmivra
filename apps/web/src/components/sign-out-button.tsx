'use client';

import { Button } from '@firmivra/ui';
import { useMe } from './signed-in';

/** "Sign out" for pages inside a signed-in layout that have no app shell, like /setup. */
export function SignOutButton() {
  const { signOut } = useMe();
  return (
    <Button variant="ghost" onClick={() => void signOut()}>
      Sign out
    </Button>
  );
}
