// The plan ladder lives in src/platform-plans.ts (Oct 24), so the migrate image's one-offs (the
// prod bootstrap) can run it; the seeds keep importing it from here.
export { seedPlatformPlans } from '../src/platform-plans.js';
