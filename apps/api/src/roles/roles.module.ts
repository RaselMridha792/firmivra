import { Global, Module } from '@nestjs/common';
import { PermissionGrantsService } from './permission-grants.service.js';
import { RolesController } from './roles.controller.js';
import { RolesService } from './roles.service.js';

/**
 * Roles and the permission grid (R55; contract in packages/types/src/staff/roles.ts). Global so
 * the roles guard can ask `PermissionGrantsService` what a role may do in a firm.
 */
@Global()
@Module({
  controllers: [RolesController],
  providers: [PermissionGrantsService, RolesService],
  exports: [PermissionGrantsService],
})
export class RolesModule {}
