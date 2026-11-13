// R55, Tasks A4 (Octavia's Tasks review of Oct 23): only the Owner and Admins manage task
// automations (the TASKS category), whatever other rights a role's grid gives; the other categories
// follow the module's grid as before.
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { assertManagesCategory, type Perms } from '../../src/automations/automations.common.js';

const admin: Perms = { admin: true, write: true, activate: true, export: true, manage: true };
// A role the grid gives Automations write, activate and manage, but not Owner or Admin.
const writer: Perms = { admin: false, write: true, activate: true, export: true, manage: true };

describe('task automations (Tasks A4)', () => {
  it('are the Owner and Admins’ alone to manage', () => {
    expect(() => assertManagesCategory(admin, 'TASKS')).not.toThrow();
    expect(() => assertManagesCategory(writer, 'TASKS')).toThrow(ForbiddenException);
  });

  it('leave the other categories to the grid', () => {
    for (const category of ['CLIENTS', 'LEADS', 'COMPLIANCE_DEADLINES', 'COMMUNICATIONS'])
      expect(() => assertManagesCategory(writer, category)).not.toThrow();
  });
});
