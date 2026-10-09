/** A Firm Sign date, as every list shows it; a dash for none. */
export const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '–';

/** "1 day", "3 days". */
export const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
