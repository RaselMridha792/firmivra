'use client';

import type { BookkeepingReportFigures, BookkeepingReportRow } from '@firmivra/types';
import { Button, Modal } from '@firmivra/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { BK_ERRORS, BK_KEY, dayText, money } from './bookkeeping-shared';

// BK-RPT (Octavia's Oct 25 Bookkeeping review): a report's figures from the client's ledger,
// statements, refunds, settlements and close for its period, previewed before anything is stored;
// Generate Version keeps them as a numbered version that never changes (a later one is generated
// instead); each version downloads as CSV. A Balance Sheet or Cash Flow waits for each reconciled
// account's statement, and the figures say what they rest on.

/** The line under the figures: the report's headline totals. */
function headline(f: BookkeepingReportFigures): string {
  const t = (k: string) => f.totals[k] ?? 0;
  switch (f.type) {
    case 'PROFIT_LOSS':
      return `Net income ${money(t('netIncomeCents'))}`;
    case 'TRIAL_BALANCE':
    case 'GENERAL_LEDGER':
      return `Debits ${money(t('debitsCents'))} · Credits ${money(t('creditsCents'))}`;
    case 'BALANCE_SHEET':
      return `Assets ${money(t('assetsCents'))} · Liabilities ${money(t('liabilitiesCents'))} · Net assets ${money(t('netAssetsCents'))}`;
    case 'CASH_FLOW':
      return `Beginning cash ${money(t('beginningCashCents'))} · Net change ${money(t('netChangeCents'))} · Ending cash ${money(t('endingCashCents'))}`;
    case 'RECONCILIATION':
      return `${t('approvedCount')} of ${t('accountsCount')} approved · ${t('openCount')} open · difference ${money(t('differenceCents'))}`;
    case 'MISSING_DOCUMENTS':
      return `${t('receiptsMissing')} receipts (${money(t('amountWithoutReceiptCents'))}) · ${t('statementsMissing')} statements missing`;
    case 'BOOKKEEPING_STATUS':
      return `${t('closeStepsDone')} of ${t('closeStepsDone') + t('closeStepsOpen')} close steps done`;
    default:
      return `${f.lineCount} lines · net ${money(t('netCents'))}`;
  }
}

function Figures({ f }: { f: BookkeepingReportFigures }) {
  return (
    <div className="flex flex-col gap-3 text-sm" data-testid="report-figures">
      {f.basisNote ? <p className="rounded-lg bg-info-soft p-2 text-info">{f.basisNote}</p> : null}
      {f.notes.length ? (
        <ul
          className="flex flex-col gap-1 rounded-lg bg-warning-soft p-2 text-warning"
          data-testid="figures-notes"
        >
          {f.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
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
                        {r.amountCents !== undefined ? money(r.amountCents) : ''}
                        {r.amountCents !== undefined && r.count !== undefined ? ' · ' : ''}
                        {r.count !== undefined ? r.count : ''}
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
        {headline(f)}
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
      setError(errorMessage(e, BK_ERRORS));
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
          <Button
            disabled={busy || !p?.supported || p.missingStatements.length > 0}
            onClick={() => void generate()}
          >
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
            {p.missingStatements.length ? (
              <p className="text-sm text-text" data-testid="figures-waiting">
                Generate Version waits for the period&apos;s statement of{' '}
                {p.missingStatements.join(', ')}: balances come from statements, never estimates.
              </p>
            ) : null}
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
