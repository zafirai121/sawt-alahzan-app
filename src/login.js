// Signing in with a password through the site's gate (web.soutalahzan.com/api/login,
// the site's functions/api/login.js), the same as the site and the phone app:
// five tries freely, then the robot check (Cloudflare Turnstile) on each, from
// the sixth wrong password a wait that grows, and the tenth locks password
// sign-in for two days. What each answer means, and what the listener is told
// (tests/login.test.mjs).

export const LOGIN_GATE = 'https://web.soutalahzan.com/api/login';
// Cloudflare Turnstile: the site's key, or Cloudflare's always-passing test key on this computer
export const TURNSTILE_SITE_KEY = '0x4AAAAAAFx4HoeG6BTR-jqv';
export const TURNSTILE_TEST_KEY = '1x00000000000000000000AA';

/** The gate's answer: { ok: true, session } or { ok: false, reason, … } */
export function gateAnswer(status, body) {
  if (status === 200 && body?.access_token) return { ok: true, session: { access_token: body.access_token, refresh_token: body.refresh_token } };
  if (status === 401) {
    return { ok: false, reason: 'invalid', next: body?.next ?? null, ...(body?.seconds && { seconds: body.seconds }), ...(body?.until && { until: body.until }) };
  }
  if (status === 428) return { ok: false, reason: 'captcha' };
  if (status === 429) return { ok: false, reason: 'wait', seconds: Number(body?.seconds) || 60 };
  if (status === 423) return { ok: false, reason: 'locked', until: Number(body?.until) || Date.now() };
  if (status === 403) return { ok: false, reason: 'unconfirmed' };
  return { ok: false, reason: 'failed' };
}

/**
 * What the listener is told after a refused try, and what the form does next:
 * show the robot check (mustCheck), and wait so many seconds (waitSeconds).
 * [lockEnds] writes when a lock ends.
 */
export function gateMessage(r, lockEnds) {
  const wrong = 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
  const check = 'أكّد أنك لست روبوتاً';
  const wait = (s) => `انتظر ${s} ثانية قبل المحاولة التالية`;
  const locked = (until) => `أُوقف الدخول بكلمة المرور لهذا الحساب حتى ${lockEnds(until)} بعد محاولات خاطئة كثيرة، ويمكنك تعيين كلمة مرور جديدة من «نسيت كلمة المرور؟»`;
  const said = (text, mustCheck = false, waitSeconds = 0) => ({ text, mustCheck, waitSeconds });
  switch (r.reason) {
    case 'invalid':
      if (r.next === 'captcha') return said(`${wrong}. ${check} قبل المحاولة التالية`, true);
      if (r.next === 'wait') return said(`${wrong}. ${wait(r.seconds ?? 30)}`, true, r.seconds ?? 30);
      if (r.next === 'locked') return said(`${wrong}. ${locked(r.until ?? Date.now())}`);
      return said(wrong);
    case 'captcha': return said(`${check}، ثم اضغط «دخول»`, true);
    case 'wait': return said(wait(r.seconds), true, r.seconds);
    case 'locked': return said(locked(r.until));
    case 'unconfirmed': return said('يرجى تأكيد البريد الإلكتروني أولاً من الرسالة التي وصلتك');
    default: return said('حدث خطأ، يرجى المحاولة مجدداً');
  }
}
