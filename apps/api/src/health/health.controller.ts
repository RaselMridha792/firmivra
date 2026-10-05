import { Controller, Get, Inject, Module, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { Database } from '@firmivra/db';
import type { HealthResponse } from '@firmivra/types';
import { Public } from '../auth/decorators.js';
import { DATABASE } from '../database/database.module.js';

/** GET /api/v1/health: used by the load balancer and the deploy smoke test. */
@Controller('health')
@Public()
export class HealthController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  async health(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    try {
      await this.db.ping();
      return { status: 'ok', db: 'ok' };
    } catch {
      res.status(503);
      return { status: 'degraded', db: 'down' };
    }
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
