// When the connection carrying a track drops before it ends. A browser reads a
// few minutes of a long file ahead (Chrome about 7 MB, some 4 to 5 minutes of
// a 192 kbps MP3), then asks for the rest only when it needs it; if that fails
// (a network change, the phone asleep, an outage longer than the browser's own
// retries) the audio element stops with a network error, or waits for data that
// never comes. The player then asks for the same file again, from where it was,
// a few times with a growing wait (main.js, "A track whose connection drops").
// The same rules as the website's src/lib/audio_recovery.ts. tests/audio_recovery.test.mjs

/** Tries in a row before the player stops (and shows the play button again) */
export const MAX_ATTEMPTS = 5;

/** No data at all for this long while it should be playing: the connection is taken as lost */
export const STALL_MS = 15_000;

/** The wait before try [attempt] (0, 1, 2…): 1 s, 2 s, 4 s, 8 s, then 15 s at most */
export const reconnectDelay = (attempt) => Math.min(1000 * 2 ** Math.max(0, attempt), 15_000);

/**
 * Whether an error of the audio element ([code], MediaError's) is worth asking
 * for the same file again: a network failure always; a file the browser could
 * not read only if it had been playing (data cut short), not one that never
 * could (missing, or not audio: skipped as before); never one the app aborted.
 */
export function shouldRetry(code, started) {
  if (code === 1) return false; // MEDIA_ERR_ABORTED
  if (code === 2) return true; // MEDIA_ERR_NETWORK
  return Boolean(started); // MEDIA_ERR_DECODE, MEDIA_ERR_SRC_NOT_SUPPORTED, or none given
}
