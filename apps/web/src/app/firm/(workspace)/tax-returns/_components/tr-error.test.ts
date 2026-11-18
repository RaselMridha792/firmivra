import { ApiRequestError } from '@firmivra/types';
import { describe, expect, it } from 'vitest';
import { trErrorMessage } from './tr-errors';

// F20b (Tax Returns Review 2): a refused change says the API's reason and its blockers.
describe('trErrorMessage', () => {
  const blocked = (message: string, details?: unknown) =>
    new ApiRequestError(409, 'STATUS_BLOCKED', message, undefined, undefined, undefined, details);

  it("says the API's reason and what still blocks it, in words", () => {
    expect(
      trErrorMessage(
        blocked('Resolve the validation errors first', {
          blockers: ['VALIDATION_ISSUES_OPEN', 'AUTHORIZATION_UNSIGNED'],
        }),
      ),
    ).toBe(
      'Resolve the validation errors first. Still to do: Resolve the open validation errors; Obtain the client signatures.',
    );
  });

  it('keeps the reason alone when no blocker is named, and the generic line only when neither is', () => {
    expect(trErrorMessage(blocked('Correct the return and take it through review first'))).toBe(
      'Correct the return and take it through review first.',
    );
    expect(trErrorMessage(blocked(''))).toBe(
      'This return cannot move there yet. Check its next steps.',
    );
  });

  it('leaves every other error to the module texts', () => {
    expect(trErrorMessage(new ApiRequestError(409, 'RETURN_LOCKED', 'Locked'))).toBe(
      'A filed return, a transmission or a decided approval does not change.',
    );
  });
});
