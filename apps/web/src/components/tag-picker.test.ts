import { describe, expect, it } from 'vitest';
import { uniqueTags } from './tag-names';

// L5: a tag is chosen once, and a name in another case is the firm's tag, never a second one.
describe('uniqueTags', () => {
  const firm = ['Back Taxes', 'High Value'];

  it('keeps each name once, in the firm’s spelling where it has the tag', () => {
    expect(uniqueTags(['back taxes', 'BACK TAXES', ' High Value ', 'New One'], firm)).toEqual([
      'Back Taxes',
      'High Value',
      'New One',
    ]);
  });

  it('drops empty names and keeps the first spelling of a new one', () => {
    expect(uniqueTags(['  ', 'Estate', 'ESTATE'], firm)).toEqual(['Estate']);
  });
});
