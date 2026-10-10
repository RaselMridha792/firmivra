/** The wizard's steps, in order (`?step=` on /firm-sign/requests/{id}/prepare). */
export const STEP_IDS = ['documents', 'recipients', 'fields', 'settings', 'review'] as const;
export type StepId = (typeof STEP_IDS)[number];

/** The address of a wizard step. */
export const stepHref = (id: string, step: StepId) =>
  `/firm-sign/requests/${id}/prepare?step=${step}`;

/** A request's cache key: the wizard, its steps and request detail share it. */
export const requestKey = (id: string) => ['esign', 'requests', id];
