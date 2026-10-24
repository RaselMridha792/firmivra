// The platform org bootstrap lives in src/platform-org.ts (Oct 24), so the prod bootstrap one-off
// can run it from the migrate image; the dev CLI and tests keep importing it from here.
export {
  bootstrapPlatformOrg,
  mapSuperAdminsToCeo,
  type MappedSuperAdmin,
} from '../src/platform-org.js';
