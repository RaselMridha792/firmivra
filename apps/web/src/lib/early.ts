// Dashboard Review Two V8: the firm workspace's first calls start together, as soon as its code
// runs, instead of one after another (the user, then the firm, then each widget). A call started
// early is handed once to the first code that asks for it. One that failed (a session renewed in
// between, say) or is older than a few seconds is called again instead, so nothing changes for the
// code that asks: it gets what calling `run` would have given it.

/** An early call older than this is not handed out: it is called again. */
const MAX_AGE_MS = 15_000;

const early = new Map<string, { at: number; promise: Promise<unknown> }>();

/** Starts `run` now under `key`, unless a recent call under that key is still waiting. */
export function startEarly(key: string, run: () => Promise<unknown>): void {
  const waiting = early.get(key);
  if (waiting && Date.now() - waiting.at < MAX_AGE_MS) return;
  const promise = run();
  // Nobody may ever take it (the page changed first): never an unhandled rejection.
  promise.catch(() => undefined);
  early.set(key, { at: Date.now(), promise });
}

/** The call started early under `key` (handed out once), else `run()`; a failed one runs again. */
export function takeEarly<T>(key: string, run: () => Promise<T>): Promise<T> {
  const waiting = early.get(key);
  early.delete(key);
  if (!waiting || Date.now() - waiting.at >= MAX_AGE_MS) return run();
  return (waiting.promise as Promise<T>).catch(() => run());
}

/** Sign-out: nothing started for the last person is handed to whoever signs in next. */
export function dropEarly(): void {
  early.clear();
}
