import { Module } from '@nestjs/common';
import { poolSecrets } from '../auth/sealed.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DOCUMENTS_CONFIG, type DocumentsConfig, loadDocumentsConfig } from '../storage/config.js';
import {
  createS3Client,
  DOCUMENT_STORAGE,
  S3DocumentStorage,
} from '../storage/document-storage.js';
import { LocationActionsJob } from './location-actions.job.js';
import { LocationPhotoService, LocationPhotoTokens } from './location-photo.service.js';
import { LocationsController } from './locations.controller.js';
import { LocationsReadService } from './locations-read.service.js';
import { LocationsService } from './locations.service.js';

/**
 * Settings > Locations (R1, Oct 21; contract in packages/types/src/settings/locations.ts): the
 * firm's locations (firm_offices), their services, hours and staff, their managers (or the main
 * location's acting), and the scheduled changes with their job. Settings > Overview reads its
 * rows through locations-read.service.ts's functions.
 */
@Module({
  controllers: [LocationsController],
  providers: [
    LocationsReadService,
    LocationsService,
    LocationPhotoService,
    LocationActionsJob,
    // The documents bucket and settings, as DocumentsModule builds them (that module exports none).
    { provide: DOCUMENTS_CONFIG, useFactory: () => loadDocumentsConfig() },
    {
      provide: DOCUMENT_STORAGE,
      inject: [DOCUMENTS_CONFIG],
      useFactory: (config: DocumentsConfig) =>
        new S3DocumentStorage(createS3Client(config), config.bucket),
    },
    {
      provide: LocationPhotoTokens,
      inject: [ENV],
      useFactory: (env: Env) => new LocationPhotoTokens(poolSecrets(env)),
    },
  ],
})
export class LocationsModule {}
