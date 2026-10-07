'use client';

import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  ApiRequestError,
  createApiClient,
  type BusinessSummary,
  type MeResponse,
} from '@firmivra/types';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Select,
  Skeleton,
  type NotificationItem,
} from '@firmivra/ui';
import { sampleNotifications } from '../features/sample-notifications';
import { adminAuth, staffAuth, AUTH_MODE, signOut } from '../lib/auth';
import { api } from '../lib/api';

export interface Workspace {
  site: 'firm' | 'admin';
  me: MeResponse;
  business?: BusinessSummary;
  role: 'OWNER' | 'ADMIN' | 'STAFF' | 'SUPER_ADMIN';
  preview: boolean;
}
interface WorkspaceSession extends Workspace {
  notifications: NotificationItem[];
  readNotification: (id: string) => void;
  readAllNotifications: () => void;
}
const Context = createContext<WorkspaceSession | null>(null);
export function useWorkspace() {
  const value = use(Context);
  if (!value) throw new Error('Workspace provider required');
  return value;
}
type State =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'error'; message: string }
  | { kind: 'denied' }
  | { kind: 'picker'; me: MeResponse }
  | { kind: 'ready'; workspace: Workspace };

export function WorkspaceProvider({
  site,
  children,
  signedOut,
}: {
  site: 'firm' | 'admin';
  children: ReactNode;
  signedOut?: ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [selected, setSelected] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        let me: MeResponse;
        try {
          me = site === 'admin' ? await adminAuth.me() : await api.me();
        } catch (e) {
          if (!(e instanceof ApiRequestError) || e.status !== 401 || AUTH_MODE === 'local') throw e;
          await (site === 'admin' ? adminAuth : staffAuth).refresh();
          me = site === 'admin' ? await adminAuth.me() : await api.me();
        }
        if (!active) return;
        const preview =
          AUTH_MODE === 'local' &&
          new URLSearchParams(window.location.search).get('preview') === '1';
        if (site === 'admin') {
          setState(
            me.platformAdmin && me.user.pool === 'ADMIN'
              ? { kind: 'ready', workspace: { site, me, role: 'SUPER_ADMIN', preview } }
              : { kind: 'denied' },
          );
          return;
        }
        const members = me.memberships.filter(
          (m) => m.status === 'ACTIVE' && ['ACTIVE', 'PENDING_SETUP'].includes(m.business.status),
        );
        if (me.user.pool !== 'STAFF' || !members.length) {
          setState({ kind: 'denied' });
          return;
        }
        const stored = selected || window.sessionStorage.getItem('fv-business-id');
        const member =
          members.find((m) => m.business.id === stored) ??
          (members.length === 1 ? members[0] : undefined);
        if (!member) {
          setState({ kind: 'picker', me });
          return;
        }
        const business = await createApiClient({
          baseUrl: '/api/v1',
          businessId: member.business.id,
        }).currentBusiness();
        if (active) {
          window.sessionStorage.setItem('fv-business-id', business.id);
          setState({
            kind: 'ready',
            workspace: { site, me, business, role: member.role, preview },
          });
        }
      } catch (e) {
        if (!active) return;
        setState(
          e instanceof ApiRequestError && e.status === 401
            ? { kind: 'signed-out' }
            : e instanceof ApiRequestError && (e.status === 403 || e.status === 404)
              ? { kind: 'denied' }
              : { kind: 'error', message: 'We could not load your workspace. Please try again.' },
        );
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [site, selected, retry]);
  if (state.kind === 'loading')
    return (
      <main
        role="status"
        aria-label="Loading workspace"
        className="mx-auto max-w-content space-y-6 p-6"
      >
        <Skeleton className="h-16" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </main>
    );
  if (state.kind === 'signed-out')
    return (
      signedOut ?? (
        <main className="mx-auto max-w-auth p-6">
          <EmptyState
            title="You are signed out"
            description="Sign in to access your workspace."
            action={
              <a href="/sign-in" className="min-h-11 py-3 text-link underline">
                Sign in
              </a>
            }
          />
        </main>
      )
    );
  if (state.kind === 'error')
    return (
      <main className="mx-auto max-w-auth space-y-4 p-6">
        <Alert title={state.message} tone="danger" />
        <Button
          onClick={() => {
            setState({ kind: 'loading' });
            setRetry((n) => n + 1);
          }}
        >
          Try again
        </Button>
      </main>
    );
  if (state.kind === 'denied')
    return (
      <main data-testid="firm-error" className="mx-auto max-w-auth p-6">
        <EmptyState
          title="Permission required"
          description="Your account does not have active access to this workspace. Contact your firm owner."
          action={
            <Button
              onClick={() => {
                void (
                  AUTH_MODE === 'local'
                    ? signOut()
                    : (site === 'admin' ? adminAuth : staffAuth).signOut()
                )
                  .then(() => {
                    window.sessionStorage.removeItem('fv-business-id');
                    router.replace('/sign-in');
                    router.refresh();
                  })
                  .catch(() =>
                    setState({
                      kind: 'error',
                      message: 'We could not sign you out. Please retry.',
                    }),
                  );
              }}
            >
              Sign out
            </Button>
          }
        />
      </main>
    );
  if (state.kind === 'picker')
    return (
      <main className="mx-auto max-w-auth p-6">
        <Card title="Choose a firm">
          <Select
            label="Firm"
            value=""
            onChange={(e) => {
              setState({ kind: 'loading' });
              setSelected(e.target.value);
            }}
            options={[
              { value: '', label: 'Select your firm' },
              ...state.me.memberships
                .filter(
                  (m) =>
                    m.status === 'ACTIVE' &&
                    ['ACTIVE', 'PENDING_SETUP'].includes(m.business.status),
                )
                .map((m) => ({ value: m.business.id, label: m.business.name })),
            ]}
          />
        </Card>
      </main>
    );
  return (
    <SessionWorkspace
      key={`${state.workspace.me.user.id}:${state.workspace.business?.id ?? 'platform'}`}
      workspace={state.workspace}
    >
      {children}
    </SessionWorkspace>
  );
}

function SessionWorkspace({ workspace, children }: { workspace: Workspace; children: ReactNode }) {
  const [read, setRead] = useState<string[]>([]);
  const samples =
    workspace.role === 'STAFF'
      ? sampleNotifications.filter((n) => n.id === 'sample-document')
      : sampleNotifications;
  const notifications =
    workspace.preview && workspace.site === 'firm'
      ? samples.map((n) => ({ ...n, read: n.read || read.includes(n.id) }))
      : [];
  return (
    <Context
      value={{
        ...workspace,
        notifications,
        readNotification: (id) => setRead((ids) => [...ids, id]),
        readAllNotifications: () => setRead(samples.map((n) => n.id)),
      }}
    >
      {children}
    </Context>
  );
}

export function OwnerOnly({ children }: { children: ReactNode }) {
  const { role } = useWorkspace();
  return role === 'OWNER' || role === 'ADMIN' ? (
    children
  ) : (
    <EmptyState
      title="Permission required"
      description="Only your firm owner or administrator can open this page."
    />
  );
}
