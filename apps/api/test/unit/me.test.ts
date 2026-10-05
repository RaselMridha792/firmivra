// GET /me parses its answer with the shared MeResponse schema, so a database status the schema
// does not know turns /me into a 500. These tests fail as soon as the two drift apart.
import { describe, expect, it } from 'vitest';
import { $Enums } from '@firmivra/db';
import {
  BusinessStatus,
  ClientAccountStatus,
  IdentityPool,
  MembershipRole,
  MeResponse,
} from '@firmivra/types';

const MembershipStatus = MeResponse.shape.memberships.element.shape.status;

describe('MeResponse statuses match the database enums', () => {
  it.each([
    ['IdentityPool', IdentityPool.options, $Enums.IdentityPool],
    ['MembershipRole', MembershipRole.options, $Enums.MembershipRole],
    ['MembershipStatus', MembershipStatus.options, $Enums.MembershipStatus],
    ['BusinessStatus', BusinessStatus.options, $Enums.BusinessStatus],
    ['ClientAccountStatus', ClientAccountStatus.options, $Enums.ClientAccountStatus],
  ])('%s', (_name, shared: readonly string[], database: Record<string, string>) => {
    expect([...shared].sort()).toEqual(Object.values(database).sort());
  });
});
