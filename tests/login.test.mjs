// The web app's sign-in through the site's gate (web.soutalahzan.com/api/login):
// what each answer means, and what the listener is told. npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateAnswer, gateMessage } from '../src/login.js';

const ends = () => '5 نوفمبر، 10:30 م';

test('aSessionSignsIn', () => {
  assert.deepEqual(gateAnswer(200, { access_token: 'a', refresh_token: 'r' }), { ok: true, session: { access_token: 'a', refresh_token: 'r' } });
});

test('eachRefusalRead', () => {
  assert.deepEqual(gateAnswer(401, { error: 'invalid', next: 'captcha' }), { ok: false, reason: 'invalid', next: 'captcha' });
  assert.deepEqual(gateAnswer(401, { error: 'invalid', next: 'wait', seconds: 30 }), { ok: false, reason: 'invalid', next: 'wait', seconds: 30 });
  assert.deepEqual(gateAnswer(428, { error: 'captcha' }), { ok: false, reason: 'captcha' });
  assert.deepEqual(gateAnswer(429, { error: 'wait', seconds: 60 }), { ok: false, reason: 'wait', seconds: 60 });
  assert.deepEqual(gateAnswer(423, { error: 'locked', until: 9 }), { ok: false, reason: 'locked', until: 9 });
  assert.deepEqual(gateAnswer(403, { error: 'unconfirmed' }), { ok: false, reason: 'unconfirmed' });
  assert.deepEqual(gateAnswer(502, {}), { ok: false, reason: 'failed' });
});

test('whatTheListenerIsTold', () => {
  const wrong = 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
  assert.deepEqual(gateMessage({ reason: 'invalid', next: null }, ends), { text: wrong, mustCheck: false, waitSeconds: 0 });
  assert.deepEqual(gateMessage({ reason: 'invalid', next: 'captcha' }, ends), { text: `${wrong}. أكّد أنك لست روبوتاً قبل المحاولة التالية`, mustCheck: true, waitSeconds: 0 });
  assert.deepEqual(gateMessage({ reason: 'invalid', next: 'wait', seconds: 30 }, ends), { text: `${wrong}. انتظر 30 ثانية قبل المحاولة التالية`, mustCheck: true, waitSeconds: 30 });
  assert.match(gateMessage({ reason: 'locked', until: 1 }, ends).text, /أُوقف الدخول بكلمة المرور لهذا الحساب حتى 5 نوفمبر، 10:30 م/);
  assert.equal(gateMessage({ reason: 'captcha' }, ends).mustCheck, true);
  assert.equal(gateMessage({ reason: 'wait', seconds: 60 }, ends).waitSeconds, 60);
});
