// What a guest was doing when the app asked them to sign in (sending their
// tracks, editing one, their uploads), kept so it carries on once they have:
// in this tab's sessionStorage, which a Google or Facebook sign-in (a trip to
// another site and back) keeps too. Only these few kinds, and for a short
// while: an old attempt never opens by surprise. (tests: tests/pending_auth.test.mjs)

export const PENDING_KEY = 'sawt_pending_signin';
/** How long an attempt is kept, in milliseconds */
export const PENDING_TTL = 15 * 60 * 1000;

const KINDS = new Set(['upload', 'edit', 'myUploads']);

/** The action as kept, or null when it is not one the app resumes. */
export function cleanAction(action) {
  if (!action || typeof action !== 'object' || !KINDS.has(action.kind)) return null;
  if (action.kind === 'edit') {
    const id = String(action.id ?? '');
    return /^\d{1,18}$/.test(id) ? { kind: 'edit', id } : null;
  }
  return { kind: action.kind };
}

/** Keeps [action] until they sign in (or give up). False when it can't be kept. */
export function rememberAction(storage, action, now = Date.now()) {
  const clean = cleanAction(action);
  if (!clean) return false;
  try {
    storage.setItem(PENDING_KEY, JSON.stringify({ ...clean, at: now }));
    return true;
  } catch {
    return false;
  }
}

/** Forgets the kept action (they closed the sign-in window without signing in). */
export function clearAction(storage) {
  try { storage.removeItem(PENDING_KEY); } catch { /* storage unavailable */ }
}

/** The kept action, taken out (it is done once): null when none, unreadable or too old. */
export function takeAction(storage, now = Date.now()) {
  let raw = null;
  try { raw = storage.getItem(PENDING_KEY); } catch { return null; }
  clearAction(storage);
  if (!raw) return null;
  let kept;
  try { kept = JSON.parse(raw); } catch { return null; }
  const at = Number(kept?.at);
  if (!Number.isFinite(at) || at > now + 60_000 || now - at > PENDING_TTL) return null;
  return cleanAction(kept);
}
