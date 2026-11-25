'use client';

import { ApiRequestError } from '@firmivra/types';
import { Button, Card, Input, PageHeader } from '@firmivra/ui';
import { useState, type FormEvent } from 'react';
import { ownerDownloads, type DownloadFile } from '../../../lib/firm-data-downloads';

const invalidLink = 'This download link is invalid or no longer active.';
function linkToken() {
  return new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
}

function groupFiles(files: DownloadFile[]) {
  const clients = new Map<
    string,
    { name: string; folders: Map<string, { name: string; files: DownloadFile[] }> }
  >();
  for (const file of files) {
    const client = clients.get(file.clientId) ?? { name: file.clientName, folders: new Map() };
    clients.set(file.clientId, client);
    const key = file.folder?.id ?? '';
    const folder = client.folders.get(key) ?? { name: file.folder?.name ?? 'No folder', files: [] };
    client.folders.set(key, folder);
    folder.files.push(file);
  }
  return Array.from(clients.entries());
}

function saveDownload(url: string, name?: string) {
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noreferrer';
  if (name) link.download = name;
  link.click();
}

type Access = {
  token: string;
  expiresAt: string;
  clients: Awaited<ReturnType<typeof ownerDownloads.clients>>;
  files: DownloadFile[];
};

export function OwnerDownload() {
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  // Access is held in this page's memory. Reloading requires another emailed code.
  const [access, setAccess] = useState<Access | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function run(task: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await task();
    } catch (failure) {
      if (failure instanceof ApiRequestError && failure.status === 429) {
        setError('Too many requests. Wait a moment and try again.');
      } else if (
        access &&
        failure instanceof ApiRequestError &&
        [401, 403, 404].includes(failure.status)
      ) {
        setAccess(null);
        setCodeSent(false);
        setError(
          'Download access is no longer available. Request a new code if your link is still active.',
        );
      } else {
        setError(fallback);
      }
    } finally {
      setBusy(false);
    }
  }

  async function sendCode() {
    const token = linkToken();
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
      setError(invalidLink);
      return;
    }
    await run(async () => {
      await ownerDownloads.requestCode(token);
      setCode('');
      setCodeSent(true);
      setNotice('Code sent to the firm owner’s email. It expires in up to 10 minutes.');
    }, 'Could not send a code. Check that the link is active and try again.');
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Enter the six-digit code.');
      return;
    }
    await run(async () => {
      const { sessionToken: token, expiresAt } = await ownerDownloads.verify(
        linkToken(),
        code.trim(),
      );
      const [clients, files] = await Promise.all([
        ownerDownloads.clients(token),
        ownerDownloads.files(token),
      ]);
      setAccess({ token, expiresAt, clients, files });
      setCode('');
    }, 'Could not verify the code or open downloads. Request a new code and try again.');
  }

  function download(file?: DownloadFile) {
    if (!access) return;
    void run(async () => {
      if (file) {
        const { url } = await ownerDownloads.fileLink(access.token, file.id);
        saveDownload(url);
      } else {
        const url = URL.createObjectURL(await ownerDownloads.csv(access.token));
        saveDownload(url, 'clients.csv');
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
    }, 'The download could not be started. Try again.');
  }

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-8 md:px-6">
      <PageHeader
        title="Closed-firm download"
        subtitle={
          access ? undefined : 'Verify your email code to access the firm’s available exports.'
        }
      />
      {error ? (
        <p role="alert" className="rounded-control bg-danger-soft p-3 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-control bg-info-soft p-3 text-sm text-text">
          {notice}
        </p>
      ) : null}
      {access ? (
        <>
          <p className="text-sm text-muted">
            This session expires at {new Date(access.expiresAt).toLocaleString()}.
          </p>
          <Card title="Client data">
            <p className="mb-3 text-sm text-muted">
              {access.clients.length}{' '}
              {access.clients.length === 1 ? 'client record' : 'client records'}
            </p>
            <Button disabled={busy} onClick={() => download()}>
              Download clients.csv
            </Button>
          </Card>
          <Card title="Files">
            <p className="mb-4 text-sm text-muted">
              Each file download link lasts up to five minutes.
            </p>
            {!access.files.length ? (
              <p className="text-sm text-muted">No files are available for download.</p>
            ) : null}
            <div className="flex flex-col gap-5">
              {groupFiles(access.files).map(([id, client]) => (
                <section key={id} className="min-w-0">
                  <h3 className="font-semibold break-all text-heading">{client.name}</h3>
                  {Array.from(client.folders.entries()).map(([id, folder]) => (
                    <div key={id} className="mt-2">
                      <h4 className="text-sm font-medium break-all text-muted">{folder.name}</h4>
                      <ul className="divide-y divide-divider">
                        {folder.files.map((file) => (
                          <li
                            key={file.id}
                            className="flex flex-wrap items-center justify-between gap-2 py-2"
                          >
                            <span className="min-w-0 break-all text-text">{file.fileName}</span>
                            <Button
                              variant="secondary"
                              disabled={busy}
                              onClick={() => download(file)}
                              aria-label={'Download ' + file.fileName}
                            >
                              Download
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          </Card>
        </>
      ) : (
        <Card title="Verify download access">
          {codeSent ? (
            <form className="flex flex-col gap-4" onSubmit={(event) => void verify(event)}>
              <Input
                label="Email code"
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                required
              />
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy}>
                  Verify code
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => void sendCode()}>
                  Send a new code
                </Button>
              </div>
            </form>
          ) : (
            <Button disabled={busy} onClick={() => void sendCode()}>
              {busy ? 'Sending…' : 'Send email code'}
            </Button>
          )}
        </Card>
      )}
    </main>
  );
}
