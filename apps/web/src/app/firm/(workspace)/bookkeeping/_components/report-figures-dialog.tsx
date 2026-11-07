'use client';

import type { BookkeepingReportFigures, BookkeepingReportRow } from '@firmivra/types';
import { Button, Modal } from '@firmivra/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { BK_KEY, dayText, money } from './bookkeeping-shared';

// BK-RPT part 1 (Octavia's Oct 25 Bookkeeping review): a report's figures from the client's
// ledger for its period, previewed before anything is stored; Generate Version keeps them as a
// numbered version that never changes (a later one is generated instead); each version downloads
// as CSV. Profit & Loss, Trial Balance, Transaction Detail and Uncategorized for now.

function Figures({ f }: { f: BookkeepingReportFigures }) {
  return (
    <div className="flex flex-col gap-3 text-sm" data-testid="report-figures">
      {f.basisNote ? <p className="rounded-lg bg-info-soft p-2 text-info">{f.basisNote}</p> : null}
      {f.sections.map((s) => (
        <section key={s.title}>
          <h3 className="mb-1 font-semibold text-heading">{s.title}</h3>
          {s.rows.length === 0 ? (
            <p className="text-muted">Nothing in this period.</p>
          ) : (
            <table className="w-full text-left">
              <tbody>
                {s.rows.map((r) => (
                  <tr key={r.label} className="border-b border-divider">
                    <td className="py-1 pr-2 text-heading">{r.label}</td>
                    {r.debitCents !== undefined ? (
                      <>
                        <td className="py-1 pr-2 text-right">{money(r.debitCents)}</td>
                        <td className="py-1 text-right">{money(r.creditCents ?? 0)}</td>
                      </>
                    ) : (
                      <td className="py-1 text-right">
                        {money(r.amountCents ?? 0)}
                        {r.count !== undefined ? ` · ${r.count}` : ''}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
      <p className="font-semibold text-heading" data-testid="report-totals">
        {f.type === 'PROFIT_LOSS'
          ? `Net income ${money(f.totals['netIncomeCents'] ?? 0)}`
          : f.type === 'TRIAL_BALANCE'
            ? `Debits ${money(f.totals['debitsCents'] ?? 0)} · Credits ${money(f.totals['creditsCents'] ?? 0)}`
            : `${f.lineCount} lines · net ${money(f.totals['netCents'] ?? 0)}`}
      </p>
    </div>
  );
}

export function ReportFiguresDialog({
  row,
  onClose,
}: {
  row: BookkeepingReportRow;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const preview = useQuery({
    queryKey: [...BK_KEY, 'report-preview', row.id],
    queryFn: () => api.bookkeeping.reportPreview(row.id),
  });
  const versions = useQuery({
    queryKey: [...BK_KEY, 'report-versions', row.id],
    queryFn: () => api.bookkeeping.reportVersions(row.id),
  });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const generate = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.bookkeeping.generateReport(row.id);
      await qc.invalidateQueries({ queryKey: [...BK_KEY] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const p = preview.data;
  return (
    <Modal
      open
      title={`${row.name}: Figures & Versions`}
      subtitle={
        p?.period ? `${dayText(p.period.start)} – ${dayText(p.period.end)}` : row.periodLabel
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
          <Button disabled={busy || !p?.supported} onClick={() => void generate()}>
            Generate Version
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-testid="figures-dialog">
        {preview.isPending ? (
          <p className="text-sm text-muted">Working out the figures…</p>
        ) : p && !p.supported ? (
          <p className="text-sm text-text" data-testid="figures-reason">
            {p.reason}
          </p>
        ) : p?.figures ? (
          <>
            <p className="text-xs text-muted">Preview: not stored until you generate a version.</p>
            <Figures f={p.figures} />
          </>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <section>
          <h3 className="mb-1 text-sm font-semibold text-heading">Versions</h3>
          {(versions.data?.items ?? []).length === 0 ? (
            <p className="text-sm text-muted">None generated yet.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm" data-testid="report-versions">
              {versions.data!.items.map((v) => (
                <li key={v.version} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-heading">
                    Version {v.version} · {new Date(v.generatedAt).toLocaleString('en-US')}
                    {v.generatedBy ? ` · ${v.generatedBy}` : ''}
                  </span>
                  <a
                    href={`/api/v1/business/bookkeeping/reports/${row.id}/versions/${v.version}/csv`}
                    className="font-medium text-link underline"
                    download
                  >
                    Download CSV
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
}
