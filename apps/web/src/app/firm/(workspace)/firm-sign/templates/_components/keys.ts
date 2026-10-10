/** Every template query starts with this, so one invalidate refreshes them all. */
export const TEMPLATES = ['esign', 'templates'] as const;
export const templateKey = (id: string) => [...TEMPLATES, 'detail', id] as const;
