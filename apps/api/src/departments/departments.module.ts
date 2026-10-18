import { Module } from '@nestjs/common';
import { DepartmentsController } from './departments.controller.js';
import { DepartmentsService } from './departments.service.js';

/**
 * Teams & Departments and the org chart (R55; contract in packages/types/src/staff/departments.ts).
 * Departments, the teams inside them, their members and the reporting lines. Owner and Admin
 * change; the others with Staff Management view read.
 */
@Module({
  controllers: [DepartmentsController],
  providers: [DepartmentsService],
})
export class DepartmentsModule {}
