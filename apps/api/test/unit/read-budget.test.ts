// The one read budget of an API task (storage/read-budget.ts): every whole-file read takes its
// bytes before it reads and gives them back after; without room, the flow's own 503.
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  PDF_PARSE_FACTOR,
  READ_BUDGET_BYTES,
  ReadBudget,
  readBudget,
  untilClosed,
} from '../../src/storage/read-budget.js';

const MB = 1024 * 1024;
const busy = () => new Error('busy');

describe('the read budget', () => {
  it('is one budget of 320 MB for the 1 GiB task', () => {
    expect(READ_BUDGET_BYTES).toBe(320 * MB);
    expect(readBudget.total).toBe(READ_BUDGET_BYTES);
    expect(readBudget.free).toBe(READ_BUDGET_BYTES);
    expect(PDF_PARSE_FACTOR).toBe(2);
  });

  it('takes bytes while they fit, and gives them back once', () => {
    const budget = new ReadBudget(300 * MB);
    const three = [100, 100, 100].map((size) => budget.tryTake(size * MB));
    expect(three.every(Boolean)).toBe(true);
    expect(budget.free).toBe(0);
    expect(budget.tryTake(1)).toBeNull();
    three[0]!();
    three[0]!(); // a second release does nothing
    expect(budget.free).toBe(100 * MB);
    expect(budget.tryTake(100 * MB + 1)).toBeNull();
    expect(budget.tryTake(100 * MB)).not.toBeNull();
    // Nothing (an empty file) always fits.
    expect(budget.tryTake(0)).not.toBeNull();
  });

  it('runs a need larger than the whole budget only when nothing else holds any', () => {
    const budget = new ReadBudget(300 * MB);
    const small = budget.tryTake(1)!;
    expect(budget.tryTake(500 * MB)).toBeNull();
    small();
    const all = budget.tryTake(500 * MB)!;
    expect(budget.free).toBe(0);
    all();
    expect(budget.free).toBe(300 * MB);
  });

  it('holds the bytes while the work runs, and gives them back when it ends or fails', async () => {
    const budget = new ReadBudget(100 * MB);
    let during = -1;
    const result = await budget.hold(60 * MB, busy, () => {
      during = budget.free;
      return Promise.resolve('read');
    });
    expect([result, during, budget.free]).toEqual(['read', 40 * MB, 100 * MB]);
    await expect(
      budget.hold(60 * MB, busy, () => Promise.reject(new Error('S3 failed'))),
    ).rejects.toThrow('S3 failed');
    expect(budget.free).toBe(100 * MB);
  });

  it("throws the flow's busy error without running the work when the bytes don't fit", async () => {
    const budget = new ReadBudget(100 * MB);
    const taken = budget.tryTake(50 * MB)!;
    let ran = false;
    await expect(
      budget.hold(51 * MB, busy, () => {
        ran = true;
        return Promise.resolve();
      }),
    ).rejects.toThrow('busy');
    expect(ran).toBe(false);
    taken();
    expect(budget.free).toBe(100 * MB);
  });

  it('hands the release to `keep` when the work succeeds (a streamed response)', async () => {
    const budget = new ReadBudget(100 * MB);
    let kept: (() => void) | null = null;
    await budget.hold(
      30 * MB,
      busy,
      () => Promise.resolve(),
      (release) => (kept = release),
    );
    expect(budget.free).toBe(70 * MB);
    kept!();
    expect(budget.free).toBe(100 * MB);
    // A failed work gives the bytes back itself; `keep` never sees them.
    let handed = false;
    await expect(
      budget.hold(
        30 * MB,
        busy,
        () => Promise.reject(new Error('refused')),
        () => (handed = true),
      ),
    ).rejects.toThrow('refused');
    expect([handed, budget.free]).toEqual([false, 100 * MB]);
  });

  it('keeps the bytes until the response closes, or gives them back at once if it has', async () => {
    const budget = new ReadBudget(100 * MB);
    const res = Object.assign(new EventEmitter(), { closed: false, destroyed: false });
    await budget.hold(40 * MB, busy, () => Promise.resolve(), untilClosed(res));
    expect(budget.free).toBe(60 * MB);
    res.emit('close');
    expect(budget.free).toBe(100 * MB);
    const gone = Object.assign(new EventEmitter(), { closed: true, destroyed: true });
    await budget.hold(40 * MB, busy, () => Promise.resolve(), untilClosed(gone));
    expect(budget.free).toBe(100 * MB);
    gone.emit('close');
    expect(budget.free).toBe(100 * MB);
  });
});
