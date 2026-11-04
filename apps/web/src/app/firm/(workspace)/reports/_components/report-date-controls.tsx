'use client';

import { Button, Input, Modal } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { dayIn, rangeProblem } from './report-dates';
import { RP_KEY } from './reports-shared';

// RP-F04, F16 (Octavia's Reports review, Oct 28): the Reports clock and the one Custom Range
// control the overview, the builder and a report share.

/** The firm's calendar day; it turns at the firm's midnight (checked each minute). */
export function useFirmDay(timezone: string): string {
  const subscribe = useCallback((onChange: () => void) => {
    const timer = window.setInterval(onChange, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const snapshot = () => dayIn(timezone);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * Keeps every Reports range on the firm's day: when the firm's midnight passes, each report,
 * card and list loads again, so Today and the rolling ranges end on the new day (RP-F04).
 */
export function ReportsDayWatch() {
  const settings = useApiQuery([...RP_KEY, 'settings'], () => api.reports.settings());
  const day = useFirmDay(settings.data?.timezone ?? 'America/New_York');
  const qc = useQueryClient();
  const seen = useRef(day);
  useEffect(() => {
    if (seen.current === day) return;
    seen.current = day;
    void qc.invalidateQueries({ queryKey: [...RP_KEY] });
  }, [day, qc]);
  return null;
}

/** Custom Range: both dates, the start on or before the end, said in place (RP-F16). */
export function CustomRangeDialog({
  initial,
  onClose,
  onApply,
}: {
  initial?: { from: string; to: string } | undefined;
  onClose: () => void;
  onApply: (range: { from: string; to: string }) => void;
}) {
  const [from, setFrom] = useState(initial?.from ?? '');
  const [to, setTo] = useState(initial?.to ?? '');
  const [tried, setTried] = useState(false);
  const problem = rangeProblem(from, to);
  // A reversed range is said at once; a missing date once Apply was pressed.
  const shown = problem && (tried || (from && to)) ? problem : undefined;
  return (
    <Modal
      open
      title="Custom Range"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setTried(true);
              if (!problem) onApply({ from, to });
            }}
          >
            Apply
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2" data-testid="custom-range">
        <Input
          label="From"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          {...(shown ? { error: shown } : {})}
        />
        <Input label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
    </Modal>
  );
}
