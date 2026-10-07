// R10 step 3: the clients service's pure helpers.
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, likeEscape } from '../../src/clients/clients.service.js';

describe('likeEscape', () => {
  it('makes LIKE wildcards and the escape character plain', () => {
    expect(likeEscape('100%')).toBe('100\\%');
    expect(likeEscape('under_score')).toBe('under\\_score');
    expect(likeEscape('back\\slash')).toBe('back\\\\slash');
    expect(likeEscape('plain')).toBe('plain');
  });
});

describe('paging cursor', () => {
  it('round-trips the last row and refuses anything else with 400', () => {
    const row = {
      createdAt: new Date('2026-10-07T12:00:00.000Z'),
      id: '0199b6a1-0000-7000-8000-000000000001',
    };
    expect(decodeCursor(encodeCursor(row))).toEqual(row);
    for (const bad of ['', 'not-a-cursor', Buffer.from('2026-10-07|nope').toString('base64url')]) {
      expect(() => decodeCursor(bad)).toThrow(BadRequestException);
    }
  });
});
