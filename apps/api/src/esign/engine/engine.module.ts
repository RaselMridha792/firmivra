import { Module } from '@nestjs/common';
import { poolSecrets } from '../../auth/sealed.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { loadDocumentsConfig } from '../../storage/config.js';
import { createS3Client } from '../../storage/document-storage.js';
import {
  CODE_HASHER,
  ESIGN_STORE,
  LINK_TOKENS,
  SIGNATURE_IMAGE_CHECK,
  SIGNER_COOKIE,
} from './engine.types.js';
import { S3EsignStore } from './esign-store.js';
import {
  HmacCodeHasher,
  PngSignatureCheck,
  RandomLinkTokens,
  SealedSignerCookie,
} from './signer-security.js';

const SECURITY = [SIGNATURE_IMAGE_CHECK, LINK_TOKENS, CODE_HASHER, SIGNER_COOKIE];

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
    { provide: SIGNATURE_IMAGE_CHECK, useClass: PngSignatureCheck },
    { provide: LINK_TOKENS, useClass: RandomLinkTokens },
    {
      provide: CODE_HASHER,
      inject: [ENV],
      useFactory: (env: Env) => new HmacCodeHasher(poolSecrets(env), env.AUTH_MODE === 'local'),
    },
    {
      provide: SIGNER_COOKIE,
      inject: [ENV],
      useFactory: (env: Env) =>
        new SealedSignerCookie(poolSecrets(env), env.NODE_ENV === 'production'),
    },
  ],
  exports: [ESIGN_STORE, ...SECURITY],
})
export class EsignEngineModule {}
