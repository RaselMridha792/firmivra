import { ApiRequestError, ConflictResult, type NamedItem } from '@firmivra/types';

/**
 * Review 2 (A2): whether an item suits the appointment's place: an any-office item always, an
 * office's own only for an in-person appointment at that office (the API's rule, 400 otherwise).
 */
export function equipmentFits(
  item: { officeId: string | null },
  method: string,
  officeId: string,
): boolean {
  return item.officeId === null || (method === 'IN_PERSON' && item.officeId === officeId);
}

/**
 * The equipment choices of the form: the live items that suit the place, then any the
 * appointment holds that were archived since (it keeps them; nothing new can take them).
 */
export function equipmentChoices(
  options: { id: string; name: string; officeId: string | null }[],
  held: NamedItem[],
  method: string,
  officeId: string,
): { value: string; label: string }[] {
  return [
    ...options
      .filter((e) => equipmentFits(e, method, officeId))
      .map((e) => ({ value: e.id, label: e.name })),
    ...held
      .filter((e) => !options.some((o) => o.id === e.id))
      .map((e) => ({ value: e.id, label: `${e.name} (archived)` })),
  ];
}

/**
 * A 409 SCHEDULING_CONFLICT's held items, by the API's own words ("Projector is already booked at
 * this time"); none when the conflict is of another kind. An item can't be booked anyway.
 */
export function equipmentClashes(error: unknown): string[] {
  if (!(error instanceof ApiRequestError) || error.code !== 'SCHEDULING_CONFLICT') return [];
  const result = ConflictResult.safeParse(error.rawDetails);
  if (!result.success) return [];
  return [
    ...new Set(result.data.conflicts.filter((c) => c.kind === 'EQUIPMENT').map((c) => c.message)),
  ];
}
