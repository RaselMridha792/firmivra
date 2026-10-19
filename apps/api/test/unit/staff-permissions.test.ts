// Staff Management's per-member grid (R55): which cells become member_permissions rows, the
// View rule, the escalation confirm, and the Owner's grid, with a stubbed transaction.
import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { TxClient } from '@firmivra/db';
import { memberGrid, writeMemberGrid } from '../../src/staff/staff-permissions.service.js';

type Row = { module: string; capability: string; granted: boolean; updatedAt?: Date };

function txWith(roleRows: Row[] = [], memberRows: Row[] = []) {
  return {
    rolePermission: { findMany: vi.fn().mockResolvedValue(roleRows) },
    memberPermission: {
      findMany: vi.fn().mockResolvedValue(memberRows.map((r) => ({ updatedAt: new Date(), ...r }))),
      upsert: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
  };
}
const write = (
  tx: ReturnType<typeof txWith>,
  over: Partial<Parameters<typeof writeMemberGrid>[1]>,
) =>
  writeMemberGrid(tx as unknown as TxClient, {
    businessId: 'b1',
    membershipId: 'm1',
    role: 'STAFF',
    grants: [],
    acknowledged: false,
    updatedById: 'm-owner',
    ...over,
  });

describe('memberGrid', () => {
  it("layers the role's default, the firm's role change and the member's own", async () => {
    const tx = txWith(
      [{ module: 'REPORTS', capability: 'VIEW', granted: true }],
      [{ module: 'CLIENTS', capability: 'VIEW', granted: false }],
    );
    const grid = await memberGrid(tx as unknown as TxClient, 'b1', 'STAFF', 'm1');
    expect(grid.member.get('CLIENTS:VIEW')).toEqual({ granted: false, source: 'MEMBER' });
    expect(grid.member.get('REPORTS:VIEW')).toEqual({ granted: true, source: 'FIRM_ROLE' });
    expect(grid.member.get('SETTINGS:MANAGE')).toEqual({ granted: false, source: 'ROLE_DEFAULT' });
    expect(grid.role.get('CLIENTS:VIEW')?.granted).toBe(true);
  });
});

describe('writeMemberGrid', () => {
  it("keeps only the cells that differ from the role's, and removes one set back", async () => {
    const tx = txWith([], [{ module: 'TASKS', capability: 'EDIT', granted: false }]);
    const out = await write(tx, {
      grants: [
        { module: 'CLIENTS', capability: 'EDIT', granted: false },
        { module: 'TASKS', capability: 'EDIT', granted: true },
        { module: 'CLIENTS', capability: 'VIEW', granted: true },
      ],
    });
    expect(out).toEqual({ changedCells: 2, escalated: false });
    expect(tx.memberPermission.upsert).toHaveBeenCalledOnce();
    expect(tx.memberPermission.upsert.mock.calls[0]![0]).toMatchObject({
      create: { module: 'CLIENTS', capability: 'EDIT', granted: false, updatedById: 'm-owner' },
    });
    expect(tx.memberPermission.delete).toHaveBeenCalledWith({
      where: {
        businessId_membershipId_module_capability: {
          businessId: 'b1',
          membershipId: 'm1',
          module: 'TASKS',
          capability: 'EDIT',
        },
      },
    });
  });

  it('refuses a capability without View in its module', async () => {
    const err = await write(txWith(), {
      grants: [{ module: 'CLIENTS', capability: 'VIEW', granted: false }],
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({
      code: 'PERMISSION_NEEDS_VIEW',
    });
  });

  it('asks before giving more than the role, and writes it once confirmed', async () => {
    const more = [{ module: 'SETTINGS', capability: 'VIEW', granted: true }] as const;
    const err = await write(txWith(), { grants: more }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({
      code: 'PERMISSION_ESCALATION',
    });
    const tx = txWith();
    expect(await write(tx, { grants: more, acknowledged: true })).toEqual({
      changedCells: 1,
      escalated: true,
    });
  });

  it('checks without writing on a dry run, and never changes an Owner', async () => {
    const tx = txWith();
    await write(tx, {
      grants: [{ module: 'CLIENTS', capability: 'EDIT', granted: false }],
      dryRun: true,
    });
    expect(tx.memberPermission.upsert).not.toHaveBeenCalled();
    await expect(write(txWith(), { role: 'OWNER' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
