import { Module } from '@nestjs/common';
import { BookkeepingClientsService } from './bookkeeping-clients.service.js';
import { BookkeepingConnectionsService } from './bookkeeping-connections.service.js';
import { BookkeepingPeriodsService } from './bookkeeping-periods.service.js';
import { BookkeepingReportsService } from './bookkeeping-reports.service.js';
import { BookkeepingStatusService } from './bookkeeping-status.service.js';
import { BookkeepingController } from './bookkeeping.controller.js';

/** The firm's bookkeeping work (contract in packages/types/src/bookkeeping). */
@Module({
  controllers: [BookkeepingController],
  providers: [
    BookkeepingStatusService,
    BookkeepingClientsService,
    BookkeepingConnectionsService,
    BookkeepingPeriodsService,
    BookkeepingReportsService,
  ],
})
export class BookkeepingModule {}
