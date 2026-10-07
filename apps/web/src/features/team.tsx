'use client';

import { useEffect, useState } from 'react';
import {
  ChangeTeamRoleRequest,
  FirmMember,
  ListTeamMembersResponse,
  ResendTeamInviteResponse,
} from '@firmivra/types';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  Select,
  Skeleton,
  Table,
} from '@firmivra/ui';
import { OwnerOnly, useWorkspace } from '../components/workspace-context';
import { workspaceError, workspaceRequest } from '../lib/workspace-api';
import { ContactFields, PageHeading, Status, UnavailableAction } from './screen-kit';

type Row = {
  id: string;
  name: string;
  email: string;
  role: FirmMember['role'];
  status: FirmMember['status'];
};
const examples: Row[] = [
  {
    id: 'sample-owner',
    name: 'Casey Taylor',
    email: 'casey@example.test',
    role: 'OWNER',
    status: 'ACTIVE',
  },
  {
    id: 'sample-staff',
    name: 'Riley Jordan',
    email: 'riley@example.test',
    role: 'STAFF',
    status: 'ACTIVE',
  },
  {
    id: 'sample-invite',
    name: 'Sam Parker',
    email: 'sam@example.test',
    role: 'STAFF',
    status: 'INVITED',
  },
];
const row = (member: FirmMember): Row => ({
  id: member.id,
  name: member.user.name,
  email: member.user.email,
  role: member.role,
  status: member.status,
});
export function Team() {
  return (
    <OwnerOnly>
      <TeamPanel />
    </OwnerOnly>
  );
}
function TeamPanel() {
  const { business, preview, role } = useWorkspace();
  const businessId = business?.id ?? '';
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(!preview);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<{
    member: Row;
    action: 'role' | 'deactivate' | 'resend-invite';
  } | null>(null);
  const [nextRole, setNextRole] = useState<FirmMember['role']>('STAFF');
  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ limit: '25' });
    if (status) query.set('status', status);
    if (cursor) query.set('cursor', cursor);
    workspaceRequest(businessId, `/business/team?${query}`, ListTeamMembersResponse, {
      signal: controller.signal,
    })
      .then((response) => {
        if (controller.signal.aborted) return;
        setItems((current) =>
          cursor ? [...current, ...response.items.map(row)] : response.items.map(row),
        );
        setNextCursor(response.nextCursor);
        setError('');
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          setItems([]);
          setNextCursor(null);
          setError(workspaceError(failure));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [businessId, cursor, preview, revision, status]);
  function refresh() {
    setLoading(true);
    setCursor(null);
    setRevision((value) => value + 1);
  }
  async function submit() {
    if (!selection || preview) return;
    setBusy(true);
    setError('');
    try {
      if (selection.action === 'role') {
        await workspaceRequest(
          businessId,
          `/business/team/${selection.member.id}/role`,
          FirmMember,
          { method: 'PATCH', body: ChangeTeamRoleRequest.parse({ role: nextRole }) },
        );
        setNotice('Member role saved.');
      } else if (selection.action === 'deactivate') {
        await workspaceRequest(
          businessId,
          `/business/team/${selection.member.id}/deactivate`,
          FirmMember,
          { method: 'POST' },
        );
        setNotice('Member access deactivated for this firm.');
      } else {
        const result = await workspaceRequest(
          businessId,
          `/business/team/${selection.member.id}/resend-invite`,
          ResendTeamInviteResponse,
          { method: 'POST' },
        );
        if (!result.accepted) throw new Error('Invite resend was not accepted');
        setNotice('Invite resend accepted for delivery.');
      }
      setSelection(null);
      refresh();
    } catch (failure) {
      setError(workspaceError(failure));
    } finally {
      setBusy(false);
    }
  }
  const rows = (preview ? examples : items).filter(
    (member) =>
      `${member.name} ${member.email}`.toLowerCase().includes(search.toLowerCase()) &&
      (!preview || !status || member.status === status),
  );
  const permitted = (member: Row) =>
    member.role !== 'OWNER' &&
    member.status !== 'DEACTIVATED' &&
    (role === 'OWNER' || member.role === 'STAFF');
  function choose(member: Row, action: 'role' | 'deactivate' | 'resend-invite') {
    setError('');
    setNextRole(member.role);
    setSelection({ member, action });
  }
  return (
    <>
      <PageHeading
        title="Team"
        description="Manage the people who can access your firm workspace."
        action={
          <UnavailableAction label="Invite member">
            <ContactFields includeRole />
          </UnavailableAction>
        }
      />
      {notice ? <Alert title={notice} tone="success" /> : null}
      {error ? (
        <Alert title={error} tone="danger">
          <Button variant="link" onClick={refresh}>
            Retry
          </Button>
        </Alert>
      ) : null}
      <Card>
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <Input
            label="Search loaded team members"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Select
            label="Member status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setCursor(null);
              setLoading(!preview);
            }}
            options={[
              { value: '', label: 'All statuses' },
              { value: 'ACTIVE', label: 'Active' },
              { value: 'INVITED', label: 'Invited' },
              { value: 'DEACTIVATED', label: 'Deactivated' },
            ]}
          />
        </div>
        {loading ? (
          <div role="status" aria-label="Loading team">
            <Skeleton />
            <Skeleton />
          </div>
        ) : error && !items.length && !preview ? (
          <EmptyState
            title="Team could not be loaded"
            description="Retry to load the current firm's members."
          />
        ) : (
          <Table
            caption="Team members"
            rows={rows}
            rowKey={(member) => member.id}
            columns={[
              {
                id: 'name',
                label: 'Name',
                cell: (member) => member.name,
                sortValue: (member) => member.name,
              },
              { id: 'email', label: 'Email', cell: (member) => member.email },
              { id: 'role', label: 'Role', cell: (member) => member.role },
              { id: 'status', label: 'Status', cell: (member) => <Status value={member.status} /> },
              {
                id: 'actions',
                label: 'Actions',
                cell: (member) =>
                  permitted(member) ? (
                    <div className="flex flex-wrap gap-2">
                      <Button variant="link" onClick={() => choose(member, 'role')}>
                        Change role
                      </Button>
                      <Button
                        variant="link"
                        onClick={() =>
                          choose(
                            member,
                            member.status === 'INVITED' ? 'resend-invite' : 'deactivate',
                          )
                        }
                      >
                        {member.status === 'INVITED' ? 'Resend invite' : 'Deactivate'}
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted">
                      {member.role === 'OWNER' ? 'Owner access protected' : 'Access restricted'}
                    </span>
                  ),
              },
            ]}
            emptyTitle={search || status ? 'No matching members' : 'No team members'}
          />
        )}
        {nextCursor && !preview ? (
          <Button
            variant="secondary"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              setCursor(nextCursor);
            }}
          >
            Load more members
          </Button>
        ) : null}
      </Card>
      <Modal
        open={selection !== null}
        title={
          selection?.action === 'role'
            ? 'Change member role'
            : selection?.action === 'deactivate'
              ? 'Deactivate member access'
              : 'Resend member invite'
        }
        onClose={() => {
          if (!busy) setSelection(null);
        }}
      >
        <p className="mb-4">{selection?.member.name}</p>
        {selection?.action === 'role' ? (
          <Select
            label="New role"
            value={nextRole}
            onChange={(event) => setNextRole(event.target.value as FirmMember['role'])}
            options={[
              { value: 'STAFF', label: 'Staff' },
              { value: 'ADMIN', label: 'Administrator' },
              ...(role === 'OWNER' ? [{ value: 'OWNER', label: 'Owner' }] : []),
            ]}
          />
        ) : (
          <p className="text-sm">
            {selection?.action === 'deactivate'
              ? 'Remove this member’s access to this firm. Their other firm memberships remain separate.'
              : 'Request a new invitation through the firm’s delivery service.'}
          </p>
        )}
        {preview ? (
          <Alert title="Local preview only">
            This example member cannot be changed on the server.
          </Alert>
        ) : null}
        {error ? <Alert title={error} tone="danger" /> : null}
        <div className="mt-6 flex gap-3">
          <Button onClick={() => void submit()} disabled={busy || preview}>
            {busy ? 'Saving…' : selection?.action === 'role' ? 'Save role' : 'Confirm'}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => setSelection(null)}>
            Cancel
          </Button>
        </div>
      </Modal>
    </>
  );
}
