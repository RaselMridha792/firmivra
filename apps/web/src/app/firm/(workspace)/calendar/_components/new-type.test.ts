import { describe, expect, it } from 'vitest';
import { addedType } from './new-type';

// Advisory B19: Check again chooses the appointment type just made in the other tab.

describe('addedType', () => {
  const types = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('is the one type that was not there before', () => {
    expect(addedType(new Set(['a', 'b']), types)).toBe('c');
  });

  it('is nothing when Create was not opened, nothing is new, or several are', () => {
    expect(addedType(null, types)).toBeNull();
    expect(addedType(new Set(['a', 'b', 'c']), types)).toBeNull();
    expect(addedType(new Set(['a']), types)).toBeNull();
  });
});
