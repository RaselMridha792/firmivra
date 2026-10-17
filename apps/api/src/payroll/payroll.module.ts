import { Module } from '@nestjs/common';
import { PayrollClientsService } from './payroll-clients.service.js';
import { PayrollRecordsService } from './payroll-records.service.js';
import { PayrollRunsService } from './payroll-runs.service.js';
import { PayrollWorkersService } from './payroll-workers.service.js';
import { PayrollController } from './payroll.controller.js';

/** The firm's payroll tracking (contract in packages/types/src/payroll). */
@Module({
  controllers: [PayrollController],
  providers: [
    PayrollClientsService,
    PayrollWorkersService,
    PayrollRunsService,
    PayrollRecordsService,
  ],
})
export class PayrollModule {}
