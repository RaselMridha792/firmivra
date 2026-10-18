'use client';

import type { PayrollWorker } from '@firmivra/types';
import { Button, Checkbox, Input, Modal, Select } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';
import {
  PAYROLL_ERRORS,
  PAYROLL_KEY,
  WORKER_STATUS_LABEL,
  WORKER_TYPE_LABEL,
  dollars,
  toCents,
} from './payroll-shared';

type WorkerType = PayrollWorker['workerType'];

/** Add or edit an employee or contractor. Never takes bank details: only whether direct deposit is ready. */
export function WorkerDialog({
  payrollClientId,
  worker,
  defaultType = 'FULL_TIME',
  onClose,
  onDone,
}: {
  payrollClientId: string;
  worker?: PayrollWorker;
  defaultType?: WorkerType;
  onClose: () => void;
  onDone: (text: string, saved: PayrollWorker) => void;
}) {
  const [f, setF] = useState({
    name: worker?.displayName ?? '',
    type: worker?.workerType ?? defaultType,
    status: worker?.status ?? 'ACTIVE',
    payType: worker?.payType ?? 'HOURLY',
    rate: worker?.rateCents ? dollars(worker.rateCents) : '',
    department: worker?.department ?? '',
    jobTitle: worker?.jobTitle ?? '',
    startedOn: worker?.startedOn ?? '',
    deposit: worker?.directDepositReady ?? false,
    note: '',
  });
  const [error, setError] = useState<string>();
  const set = (change: Partial<typeof f>) => setF((cur) => ({ ...cur, ...change }));
  const send = useApiMutation(
    () => {
      const common = {
        displayName: f.name.trim(),
        workerType: f.type,
        status: f.status,
        payType: f.rate ? f.payType : (f.payType ?? null),
        rateCents: f.rate ? toCents(f.rate) : null,
        department: f.department.trim() || null,
        jobTitle: f.jobTitle.trim() || null,
        startedOn: f.startedOn || null,
        directDepositReady: f.deposit,
        ...(f.note.trim() ? { changeNote: f.note.trim() } : {}),
      };
      return worker
        ? api.payroll.updateWorker(payrollClientId, worker.id, common)
        : api.payroll.addWorker(payrollClientId, common);
    },
    { invalidate: [...PAYROLL_KEY] },
  );
  const type = f.type === 'CONTRACTOR' ? 'contractor' : 'employee';
  return (
    <Modal
      open
      title={worker ? `Edit ${type}` : `Add ${type === 'contractor' ? 'Contractor' : 'Employee'}`}
      subtitle="Sensitive identifiers and bank details are never entered here."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={send.isPending}
            onClick={() => {
              if (!f.name.trim()) return setError('Enter the name');
              setError(undefined);
              send.mutate(undefined, {
                onSuccess: (saved) =>
                  onDone(worker ? 'Changes saved.' : `${f.name.trim()} added.`, saved),
                onError: (e) => setError(errorMessage(e, PAYROLL_ERRORS)),
              });
            }}
          >
            {worker ? 'Save Changes' : 'Add'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2" data-testid="worker-form">
        <Input
          label="Name *"
          value={f.name}
          maxLength={200}
          onChange={(e) => set({ name: e.target.value })}
        />
        <Select
          label="Worker type"
          value={f.type}
          onChange={(e) => set({ type: e.target.value as WorkerType })}
          options={(Object.keys(WORKER_TYPE_LABEL) as WorkerType[]).map((v) => ({
            value: v,
            label: WORKER_TYPE_LABEL[v],
          }))}
        />
        <Select
          label="Status"
          value={f.status}
          onChange={(e) => set({ status: e.target.value as typeof f.status })}
          options={(Object.keys(WORKER_STATUS_LABEL) as (keyof typeof WORKER_STATUS_LABEL)[]).map(
            (v) => ({ value: v, label: WORKER_STATUS_LABEL[v] }),
          )}
        />
        <Select
          label="Pay type"
          value={f.payType}
          onChange={(e) => set({ payType: e.target.value as typeof f.payType })}
          options={[
            { value: 'HOURLY', label: 'Hourly' },
            { value: 'SALARY', label: 'Salary (per year)' },
            { value: 'COMMISSION', label: 'Commission' },
          ]}
        />
        <Input
          label={f.payType === 'HOURLY' ? 'Pay rate ($ per hour)' : 'Pay rate ($)'}
          type="number"
          min={0}
          step="0.01"
          value={f.rate}
          onChange={(e) => set({ rate: e.target.value })}
        />
        <Input
          label="Department"
          value={f.department}
          maxLength={100}
          onChange={(e) => set({ department: e.target.value })}
        />
        <Input
          label="Job title"
          value={f.jobTitle}
          maxLength={100}
          onChange={(e) => set({ jobTitle: e.target.value })}
        />
        <Input
          label="Start date"
          type="date"
          value={f.startedOn}
          onChange={(e) => set({ startedOn: e.target.value })}
        />
        <div className="sm:col-span-2">
          <Checkbox
            label="Direct deposit is ready (validated at the provider)"
            checked={f.deposit}
            onChange={(e) => set({ deposit: e.target.checked })}
          />
        </div>
        <div className="sm:col-span-2">
          <Input
            label="Note about this change (optional)"
            value={f.note}
            maxLength={300}
            onChange={(e) => set({ note: e.target.value })}
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-danger sm:col-span-2">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
