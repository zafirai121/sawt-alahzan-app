// The library read again while the app stays open, as in the Android app
// (LibraryRefresh): a tab or an installed app left open for days would not
// show tracks and reciters added since. tests/refresh.test.mjs

/** How old the library may be when the app is come back to. */
export const STALE_MS = 30 * 60 * 1000;

/** Whether the library read at [loadedAt] (0: never) is read again at [now]. */
export const isStale = (loadedAt, now) => loadedAt === 0 || now - loadedAt >= STALE_MS;

/**
 * The tracks shown after reading the library again: the fresh ones only when
 * every page came (complete), else those added to the old ones (nothing goes
 * missing for a page that failed); newest first.
 */
export function merged(old, fresh, complete) {
  const seen = new Set();
  return (complete ? fresh : [...fresh, ...old])
    .filter((t) => !seen.has(t.id) && seen.add(t.id))
    .sort((a, b) => Number(b.id) - Number(a.id));
}

/** How long pages that failed wait before they are asked again, the round-th time; null: until the app is come back to. */
export const retryDelay = (round) => [10_000, 30_000, 60_000][round - 1] ?? null;
