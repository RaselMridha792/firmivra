import { Module } from '@nestjs/common';
import { loadDocumentsConfig } from '../../storage/config.js';
import { createS3Client } from '../../storage/document-storage.js';
import { ESIGN_STORE } from './engine.types.js';
import { S3EsignStore } from './esign-store.js';

/**
 * Firm Sign's engine (R18). R13-api imports it into its EsignModule and injects the tokens of
 * engine.types.ts. Tests override ESIGN_STORE with MemoryEsignStore.
 */
@Module({
  providers: [
    {
      provide: ESIGN_STORE,
      // The documents bucket and its settings, checked when the app starts.
      useFactory: () => {
        const config = loadDocumentsConfig();
        return new S3EsignStore(createS3Client(config), config.bucket);
      },
    },
  ],
  exports: [ESIGN_STORE],
})
export class EsignEngineModule {}
