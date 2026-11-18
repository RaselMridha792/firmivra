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

/**
 * Review 2 (W10): a 409 SCHEDULING_CONFLICT's own answer: whether the signed-in member may book
 * anyway with a reason (`canOverride`: an Owner or Admin, and no hard conflict such as the client
 * already booked then), and the conflicts' own words ("This client already has an appointment at
 * this time"). Null for any other error.
 */
export function conflictOf(error: unknown): { canOverride: boolean; messages: string[] } | null {
  if (!(error instanceof ApiRequestError) || error.code !== 'SCHEDULING_CONFLICT') return null;
  const result = ConflictResult.safeParse(error.rawDetails);
  if (!result.success) return { canOverride: false, messages: [] };
  return {
    canOverride: result.data.canOverride,
    messages: [...new Set(result.data.conflicts.map((c) => c.message))],
  };
}
