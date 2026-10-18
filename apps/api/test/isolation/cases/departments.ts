// Teams & Departments and the org chart (R55). A write case runs in a fresh world, so one record
// serves them all.
import { randomUUID } from 'node:crypto';
import type { CaseModule } from '../world.js';

const BASE = '/api/v1/business';
const tag = () => randomUUID().slice(0, 8);
const PLACEHOLDER = randomUUID();

export const records: CaseModule['records'] = {
  /** An active department of the firm. */
  staffDepartment: {
    async create({ tx, businessId }) {
      const row = await tx.department.create({
        data: { businessId, name: `Fake department ${tag()}` },
      });
      return row.id;
    },
  },
  /** Another one, to move people and teams to. */
  staffDepartmentExtra: {
    async create({ tx, businessId }) {
      const row = await tx.department.create({
        data: { businessId, name: `Fake other department ${tag()}` },
      });
      return row.id;
    },
  },
  /** An active team in the department. */
  staffTeam: {
    async create({ tx, businessId, get }) {
      const row = await tx.team.create({
        data: {
          businessId,
          departmentId: await get('staffDepartment'),
          name: `Fake team ${tag()}`,
        },
      });
      return row.id;
    },
  },
};

export const cases: CaseModule['cases'] = {
  [`GET ${BASE}/departments/:id`]: { params: { id: 'staffDepartment' } },
  [`PATCH ${BASE}/departments/:id`]: {
    params: { id: 'staffDepartment' },
    bodyIds: { headMembershipId: 'staffMembership', moveTo: 'staffDepartmentExtra' },
    body: { headMembershipId: PLACEHOLDER, moveTo: PLACEHOLDER, description: 'Fake description' },
  },
  [`POST ${BASE}/departments`]: {
    params: {},
    bodyIds: { headMembershipId: 'staffMembership' },
    body: () => ({ name: `Fake new department ${tag()}`, headMembershipId: PLACEHOLDER }),
  },
  [`GET ${BASE}/teams/:id`]: { params: { id: 'staffTeam' } },
  [`PATCH ${BASE}/teams/:id`]: {
    params: { id: 'staffTeam' },
    bodyIds: { leadMembershipId: 'staffMembership', departmentId: 'staffDepartmentExtra' },
    body: { leadMembershipId: PLACEHOLDER, departmentId: PLACEHOLDER },
  },
  [`POST ${BASE}/teams`]: {
    params: {},
    bodyIds: { departmentId: 'staffDepartment', leadMembershipId: 'staffMembership' },
    body: () => ({
      name: `Fake new team ${tag()}`,
      departmentId: PLACEHOLDER,
      leadMembershipId: PLACEHOLDER,
    }),
  },
  [`PUT ${BASE}/teams/:id/members`]: {
    params: { id: 'staffTeam' },
    bodyIds: { 'members.membershipId': 'staffMembership' },
    body: { members: [{ membershipId: PLACEHOLDER, kind: 'MEMBER' }] },
  },
};
