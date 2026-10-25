'use client';

import {
  DOCUMENT_ERRORS,
  type DocumentCategory,
  type DocumentFolder,
  type UpdateDocumentSettingsRequest,
} from '@firmivra/types';
import { Button, Callout, Modal, PageHeader, Tabs, Toast } from '@firmivra/ui';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bell,
  CalendarBlank,
  CaretRight,
  ClockClockwise,
  ClockCounterClockwise,
  FileArrowUp,
  FilePlus,
  Files,
  FileText,
  FolderSimple,
  FolderSimplePlus,
  Gear,
  Lightbulb,
  Lightning,
  ListNumbers,
  ShieldCheck,
  Users,
  UsersThree,
  type Icon,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { useFirm } from '../../../../../../components/firm-context';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { FolderEditor } from './folder-editor';
import {
  buildTree,
  draftOf,
  type FolderDraft,
  folderChanges,
  moved,
  newDraft,
  siblingsOf,
} from './folder-parts';
import { FolderTree } from './folder-tree';
import {
  DocumentTypes,
  ExpirationTab,
  FileTab,
  FolderRules,
  Panel,
  ReviewerForm,
  type SettingsState,
} from './settings-tabs';

const TABS: { id: string; label: string; icon: Icon }[] = [
  { id: 'folders', label: 'Folders & Categories', icon: FolderSimple },
  { id: 'access', label: 'Access & Permissions', icon: Users },
  { id: 'expiration', label: 'Expiration & Reminders', icon: ClockClockwise },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'files', label: 'File Settings', icon: FileText },
  { id: 'general', label: 'General Settings', icon: Gear },
];
const ERRORS: Record<string, string> = {
  ...DOCUMENT_ERRORS,
  FOLDER_NOT_EMPTY: 'This folder still holds documents or subfolders. Move them out first.',
  FOLDER_TOO_DEEP: 'Folders go at most five levels deep, and never inside themselves.',
  FOLDER_SCOPE:
    'A Firm Internal folder holds only internal documents and sits under another firm folder.',
  DUPLICATE_NAME: 'That name is already used here. Choose another.',
  NOT_A_MEMBER: 'That team member is no longer active. Choose another.',
};
const FOLDERS = ['document-folders'];
const SETTINGS = ['document-settings'];
const CATEGORIES = ['document-categories'];

type Mode = { kind: 'edit'; id: string } | { kind: 'new'; parentId: string | null };

const dateText = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function QuickAction({
  icon: Glyph,
  label,
  href,
  onClick,
}: {
  icon: Icon;
  label: string;
  href?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <Glyph aria-hidden weight="fill" className="size-5 shrink-0 text-action" />
      <span className="flex-1 text-left">{label}</span>
      <CaretRight aria-hidden weight="bold" className="size-4 text-heading" />
    </>
  );
  const cls =
    'flex min-h-11 w-full items-center gap-3 px-3 text-sm font-medium text-heading hover:bg-canvas';
  return (
    <li>
      {href ? (
        <Link href={href} className={cls}>
          {body}
        </Link>
      ) : (
        <button type="button" onClick={onClick} className={cls}>
          {body}
        </button>
      )}
    </li>
  );
}

function InfoRow({
  icon: Glyph,
  label,
  children,
}: {
  icon: Icon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[1.5rem_6.5rem_minmax(0,1fr)] items-center gap-2 py-1.5 text-sm">
      <Glyph aria-hidden weight="regular" className="size-5 text-heading" />
      <dt className="text-heading">{label}</dt>
      <dd className="text-text">{children}</dd>
    </div>
  );
}

/**
 * Document Settings (Documents design, Frame 6): the firm's folders and their defaults, document
 * types, and the settings new requests, shares and uploads start from. Owners and Admins change
 * them (the API checks); everyone else reads them.
 */
export function DocumentSettingsScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const { role } = useFirm();
  const canEdit = role === 'OWNER' || role === 'ADMIN';
  const [tab, setTab] = useState(() =>
    TABS.some((t) => t.id === params.get('tab')) ? params.get('tab')! : 'folders',
  );
  const folders = useQuery({ queryKey: FOLDERS, queryFn: () => api.documentLibrary.folders() });
  const settings = useQuery({ queryKey: SETTINGS, queryFn: () => api.documentLibrary.settings() });
  const categories = useQuery({ queryKey: CATEGORIES, queryFn: () => api.documents.categories() });
  const team = useQuery({ queryKey: ['team'], queryFn: () => api.team.list(), enabled: canEdit });
  const list = folders.data ?? [];
  const folderState = folders.isPending ? 'loading' : folders.isError ? 'error' : 'ready';
  const settingsState: SettingsState = settings.isPending
    ? { kind: 'loading' }
    : settings.isError
      ? { kind: 'error' }
      : { kind: 'ready', settings: settings.data };

  const [note, setNote] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [draft, setDraft] = useState<FolderDraft | null>(null);
  const [nameError, setNameError] = useState('');
  const [reorder, setReorder] = useState<{ parentId: string | null; ids: string[] } | null>(null);
  const [removing, setRemoving] = useState<DocumentFolder | null>(null);

  // The folder shown: the chosen one, else the first folder inside the first top folder.
  const tree = buildTree(list);
  const fallback = tree[0]?.children[0]?.folder ?? tree[0]?.folder ?? null;
  const current: Mode | null = mode ?? (fallback ? { kind: 'edit', id: fallback.id } : null);
  const folder = current?.kind === 'edit' ? (list.find((f) => f.id === current.id) ?? null) : null;
  const parent =
    current?.kind === 'new' && current.parentId
      ? (list.find((f) => f.id === current.parentId) ?? null)
      : null;
  const shownDraft: FolderDraft | null =
    draft ??
    (folder ? draftOf(folder) : current?.kind === 'new' ? newDraft(parent, 'CLIENT') : null);

  async function act(
    done: string,
    run: () => Promise<unknown>,
    keys: string[][],
  ): Promise<boolean> {
    setBusy(true);
    try {
      await run();
      await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      setNote({ text: done, tone: 'success' });
      return true;
    } catch (error) {
      setNote({ text: errorMessage(error, ERRORS), tone: 'error' });
      return false;
    } finally {
      setBusy(false);
    }
  }
  const open = (next: Mode | null) => {
    setMode(next);
    setDraft(null);
    setNameError('');
  };
  const startNew = (p: DocumentFolder | null) => {
    setTab('folders');
    open({ kind: 'new', parentId: p?.id ?? null });
  };
  const startReorder = (parentId: string | null) =>
    setReorder({ parentId, ids: siblingsOf(list, parentId).map((f) => f.id) });

  async function save() {
    if (!shownDraft) return;
    if (!shownDraft.name.trim()) return setNameError('Enter the folder’s name.');
    setNameError('');
    if (folder) {
      const changes = folderChanges(folder, shownDraft);
      if (!changes) return setNote({ text: 'Nothing changed.', tone: 'success' });
      if (
        await act(
          `${shownDraft.name.trim()} was saved.`,
          () => api.documentLibrary.updateFolder(folder.id, changes),
          [FOLDERS],
        )
      )
        setDraft(null);
      return;
    }
    const d = shownDraft;
    let created: DocumentFolder | null = null;
    const ok = await act(
      `${d.name.trim()} was created.`,
      async () => {
        created = await api.documentLibrary.createFolder({
          name: d.name.trim(),
          parentId: d.parentId,
          ...(d.parentId ? {} : { scope: d.scope }),
          description: d.description.trim() || null,
          color: d.color,
          requireExpiryDate: d.requireExpiryDate,
          remindBeforeExpiry: d.remindBeforeExpiry,
          allowClientUploads: d.scope === 'CLIENT' && d.allowClientUploads,
          notifyStaffOnUpload: d.notifyStaffOnUpload,
          defaultClientAccess: d.scope === 'CLIENT' ? d.defaultClientAccess : 'NONE',
        });
      },
      [FOLDERS],
    );
    if (ok && created) open({ kind: 'edit', id: (created as DocumentFolder).id });
  }

  const updateFolder = (f: DocumentFolder, next: Partial<DocumentFolder>) =>
    void act(`${f.name} was saved.`, () => api.documentLibrary.updateFolder(f.id, next), [FOLDERS]);
  // The saved settings go straight into the cache, so no form starts from the old ones meanwhile.
  const saveSettings = (body: UpdateDocumentSettingsRequest) =>
    act(
      'Document settings were saved.',
      async () =>
        queryClient.setQueryData(SETTINGS, await api.documentLibrary.updateSettings(body)),
      [SETTINGS],
    );
  const members = team.data
    ? team.data
        .filter((m) => m.status === 'ACTIVE')
        .map((m) => ({ value: m.user.id, label: m.user.name }))
    : null;
  const expiryDays = settings.data?.documentExpiryReminderDays ?? null;

  const foldersTab = (
    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,19.5rem)_minmax(0,1fr)_minmax(0,16rem)]">
      <FolderTree
        folders={list}
        state={folderState}
        selectedId={current?.kind === 'edit' ? current.id : null}
        canEdit={canEdit}
        on={{
          select: (f) => open({ kind: 'edit', id: f.id }),
          addFolder: () => startNew(null),
          addSubfolder: (f) => startNew(f),
          reorder: (f) => startReorder(f.parentId),
          remove: (f) => setRemoving(f),
        }}
      />
      {shownDraft && current ? (
        <FolderEditor
          key={current.kind === 'edit' ? current.id : `new-${current.parentId ?? 'top'}`}
          folder={folder}
          parent={parent}
          draft={shownDraft}
          onDraft={(next) => setDraft({ ...shownDraft, ...next })}
          folders={list}
          canEdit={canEdit}
          busy={busy}
          expiryReminderDays={expiryDays}
          errors={nameError ? { name: nameError } : {}}
          onSave={() => void save()}
          onCancel={() => (folder ? setDraft(null) : open(null))}
          onDelete={setRemoving}
          onAddSubfolder={(f) => startNew(f)}
          onReorder={startReorder}
          onSelect={(f) => open({ kind: 'edit', id: f.id })}
        />
      ) : (
        <section className="flex items-center justify-center rounded-card border border-border bg-surface p-8 text-center text-sm text-muted">
          {folderState === 'ready'
            ? 'No folders yet. Add Folder makes the first one.'
            : folderState === 'error'
              ? 'Folders could not be loaded right now.'
              : 'Loading folders…'}
        </section>
      )}
      <aside className="flex min-w-0 flex-col gap-4" aria-label="Folder shortcuts">
        <section
          className="rounded-card border border-border bg-surface p-4"
          data-testid="quick-actions"
        >
          <h2 className="mb-2 flex items-center gap-2 font-display text-xl font-bold text-heading">
            <Lightning aria-hidden weight="fill" className="size-6 text-action" />
            Quick Actions
          </h2>
          <ul className="flex flex-col divide-y divide-divider rounded-control border border-border">
            {canEdit ? (
              <QuickAction
                icon={FolderSimplePlus}
                label="Add New Folder"
                onClick={() => startNew(null)}
              />
            ) : null}
            {canEdit ? (
              <QuickAction
                icon={ListNumbers}
                label="Reorder Folders"
                onClick={() => startReorder(folder?.parentId ?? null)}
              />
            ) : null}
            <QuickAction icon={FileArrowUp} label="Import Documents" href="/documents/upload" />
            <QuickAction icon={FilePlus} label="Manage Templates" href="/documents/requests" />
            <QuickAction
              icon={UsersThree}
              label="Set Default Permissions"
              onClick={() => setTab('access')}
            />
            <QuickAction
              icon={ClockCounterClockwise}
              label="View Folder Activity"
              href="/audit-log"
            />
          </ul>
        </section>
        <section
          className="rounded-card border border-border bg-surface p-4"
          data-testid="folder-info"
        >
          <h2 className="mb-2 font-display text-xl font-bold text-heading">Folder Info</h2>
          {folder ? (
            <dl>
              <InfoRow icon={Files} label="Documents">
                {folder.documentCount}
              </InfoRow>
              <InfoRow icon={FolderSimple} label="Subfolders">
                {folder.subfolderCount}
              </InfoRow>
              <InfoRow icon={CalendarBlank} label="Created">
                {dateText(folder.createdAt)}
              </InfoRow>
              <InfoRow icon={ClockClockwise} label="Last Updated">
                {dateText(folder.updatedAt)}
              </InfoRow>
            </dl>
          ) : (
            <p className="text-sm text-muted">Choose a folder to see its details.</p>
          )}
        </section>
        <Callout icon={Lightbulb} iconStyle="disc" tone="blue" surface="info" title="Tip">
          Organize folders by client type or service to make it easier to find and manage documents.
          You can always reorder folders later.
        </Callout>
      </aside>
    </div>
  );

  const panels: Record<string, ReactNode> = {
    folders: foldersTab,
    access: (
      <Panel
        title="Access & Permissions"
        subtitle="What each client sees of their own new documents in each folder, and where they can upload. Firm Internal folders are never shown to clients."
        testId="access-settings"
      >
        <FolderRules
          folders={list}
          state={folderState}
          canEdit={canEdit}
          busy={busy}
          kind="access"
          onChange={updateFolder}
        />
        <p className="flex items-center gap-2 text-sm text-muted">
          <ShieldCheck aria-hidden weight="fill" className="size-5 text-success" />
          Your team&apos;s access follows each person&apos;s role.
          <Link href="/settings/users" className="font-medium text-action underline">
            Users &amp; Roles
          </Link>
        </p>
      </Panel>
    ),
    expiration: (
      <ExpirationTab state={settingsState} canEdit={canEdit} busy={busy} onSave={saveSettings} />
    ),
    notifications: (
      <Panel
        title="Notifications"
        subtitle="Who reviews new client uploads, and which folders tell the client's assigned staff."
        testId="notification-settings"
      >
        <ReviewerForm
          state={settingsState}
          members={members}
          canEdit={canEdit}
          busy={busy}
          onSave={saveSettings}
        />
        <FolderRules
          folders={list}
          state={folderState}
          canEdit={canEdit}
          busy={busy}
          kind="notify"
          onChange={updateFolder}
        />
      </Panel>
    ),
    files: <FileTab state={settingsState} canEdit={canEdit} busy={busy} onSave={saveSettings} />,
    general: (
      <Panel
        title="Document Types"
        subtitle="The types documents are filed under, and how long each type is kept. An archived type is kept on its documents but not offered for new ones."
        testId="general-settings"
      >
        <DocumentTypes
          categories={categories.data ?? []}
          state={categories.isPending ? 'loading' : categories.isError ? 'error' : 'ready'}
          canEdit={canEdit}
          busy={busy}
          onCreate={(name, retentionYears) =>
            act(
              `${name} was added.`,
              () => api.documentLibrary.createCategory({ name, retentionYears }),
              [CATEGORIES],
            )
          }
          onUpdate={(c: DocumentCategory, next) =>
            act(
              next.archived === undefined
                ? `${c.name} was saved.`
                : `${c.name} was ${next.archived ? 'archived' : 'restored'}.`,
              () => api.documentLibrary.updateCategory(c.id, next),
              [CATEGORIES],
            )
          }
        />
      </Panel>
    ),
  };

  const siblings = reorder
    ? (reorder.ids.map((id) => list.find((f) => f.id === id)).filter(Boolean) as DocumentFolder[])
    : [];
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="document-settings">
      <PageHeader
        above={
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-2 text-sm">
              <li>
                <Link href="/documents" className="text-text hover:text-action hover:underline">
                  Documents
                </Link>
              </li>
              <li aria-hidden>
                <CaretRight weight="bold" className="size-3 text-muted" />
              </li>
              <li>
                <Link href="/settings" className="text-text hover:text-action hover:underline">
                  Settings
                </Link>
              </li>
              <li aria-hidden>
                <CaretRight weight="bold" className="size-3 text-muted" />
              </li>
              <li aria-current="page" className="font-medium text-heading">
                Document Settings
              </li>
            </ol>
          </nav>
        }
        title="Document Settings"
        subtitle="Manage folders, access, expiration defaults, notifications, and other document preferences."
        actions={
          <Button variant="outline" onClick={() => router.push('/documents')}>
            <ArrowLeft aria-hidden weight="bold" className="size-5" />
            Back to Documents
          </Button>
        }
      />
      {note ? <Toast tone={note.tone} message={note.text} onDismiss={() => setNote(null)} /> : null}
      <Tabs
        label="Document settings"
        variant="folder"
        value={tab}
        onChange={setTab}
        items={TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon }))}
      />
      {panels[tab]}

      <Modal
        open={reorder !== null}
        title="Reorder Folders"
        subtitle={
          reorder?.parentId
            ? `In ${list.find((f) => f.id === reorder.parentId)?.name ?? ''}`
            : 'Top-level folders'
        }
        onClose={() => setReorder(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReorder(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy || !reorder}
              onClick={() =>
                reorder &&
                void act(
                  'The new order was saved.',
                  () => api.documentLibrary.reorderFolders(reorder),
                  [FOLDERS],
                ).then((ok) => ok && setReorder(null))
              }
            >
              Save Order
            </Button>
          </>
        }
      >
        <ol
          className="flex flex-col divide-y divide-divider rounded-control border border-border"
          data-testid="reorder-list"
        >
          {siblings.map((f, n) => (
            <li key={f.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="w-5 text-muted">{n + 1}</span>
              <span className="min-w-0 flex-1 truncate text-heading">{f.name}</span>
              <button
                type="button"
                aria-label={`Move ${f.name} up`}
                disabled={n === 0}
                onClick={() => setReorder((r) => r && { ...r, ids: moved(r.ids, f.id, -1) })}
                className="inline-flex size-9 items-center justify-center rounded-control hover:bg-canvas disabled:opacity-40"
              >
                <ArrowUp aria-hidden weight="bold" className="size-4" />
              </button>
              <button
                type="button"
                aria-label={`Move ${f.name} down`}
                disabled={n === siblings.length - 1}
                onClick={() => setReorder((r) => r && { ...r, ids: moved(r.ids, f.id, 1) })}
                className="inline-flex size-9 items-center justify-center rounded-control hover:bg-canvas disabled:opacity-40"
              >
                <ArrowDown aria-hidden weight="bold" className="size-4" />
              </button>
            </li>
          ))}
        </ol>
      </Modal>
      <Modal
        open={removing !== null}
        title={`Delete ${removing?.name ?? 'folder'}?`}
        onClose={() => setRemoving(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Keep Folder
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                const f = removing;
                if (!f) return;
                void act(`${f.name} was deleted.`, () => api.documentLibrary.deleteFolder(f.id), [
                  FOLDERS,
                ]).then((ok) => {
                  setRemoving(null);
                  if (ok) open(f.parentId ? { kind: 'edit', id: f.parentId } : null);
                });
              }}
            >
              Delete Folder
            </Button>
          </>
        }
      >
        <p className="text-sm text-text">
          Only an empty folder is deleted. A folder that still holds documents or subfolders stays
          until they are moved out.
        </p>
      </Modal>
    </div>
  );
}
