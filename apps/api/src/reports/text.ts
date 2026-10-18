/** Plain text for a name or a description: no tags, trimmed. A report name is never markup. */
export const stripText = (s: string): string => s.replace(/<[^>]*>/g, '').trim();
