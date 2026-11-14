/** The Client Portal module's query keys: one header per client, shared by every part. */
export const RECENT_KEY = ['client-portal', 'recent'] as const;
export const headerKey = (id: string) => ['client-portal', 'header', id] as const;
