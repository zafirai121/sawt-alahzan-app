// "Previous" back to the start of the track, also after a dropped connection:
// the file is asked for again from 0 (not from where it stopped), it is not
// counted again, and a pause by the listener is kept. The player's own code
// from src/main.js (playPrev, seekAudio, reloadCurrent and the resume on
// loadedmetadata), run against a stand-in audio element. npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// The text of the block that opens at the first "{" after `marker`
function block(marker) {
  const at = main.indexOf(marker);
  assert.ok(at >= 0, `not found in main.js: ${marker}`);
  let i = main.indexOf('{', at), depth = 0;
  for (let j = i; j < main.length; j++) {
    if (main[j] === '{') depth++;
    else if (main[j] === '}' && --depth === 0) return main.slice(at, j + 1);
  }
  throw new Error(`unclosed: ${marker}`);
}

const SEEK = block('function seekAudio(t)');
const RELOAD = block('async function reloadCurrent(play)');
const PREV = block('window.playPrev = () =>');
const META = block("audio.addEventListener('loadedmetadata', () => {\n  if (rec.resumeAt == null) return;")
  .replace("audio.addEventListener('loadedmetadata', ", '');

// A player at `at` seconds in the queue's track `index`
function player({ at = 0, index = 1, paused = false, broken = false, interrupted = false, error = null, resumeAt = null } = {}) {
  const queue = [{ id: 1, audioUrl: 'https://x.test/1.mp3' }, { id: 2, audioUrl: 'https://x.test/2.mp3' }];
  const calls = { reload: 0, play: 0, playTrack: [] };
  const audio = {
    currentTime: at, paused, error, readyState: error ? 1 : 4, duration: 600, src: '',
    play() { calls.play++; this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; },
  };
  const rec = { pos: at, resumeAt, started: true, broken, interrupted, attempts: 2, timer: 0, stall: 0, lastData: 0 };
  // A new connection for the same file: no data yet, the element says 0
  const loadSource = async (url) => { calls.reload++; Object.assign(audio, { src: url, currentTime: 0, readyState: 0, error: null }); };
  const window = {};
  const make = new Function('audio', 'rec', 'window', 'queue', 'queueIndex', 'currentTrack', 'loadSource', 'playTrack', 'clearRecoveryTimers', `
    ${SEEK}
    ${RELOAD}
    ${PREV}
    const onMeta = ${META};
    return { seekAudio, reloadCurrent, playPrev: window.playPrev, onMeta, index: () => queueIndex };`);
  const p = make(audio, rec, window, queue, index, queue[index], loadSource, (t) => calls.playTrack.push(t.id), () => {});
  // The file's details are in: the element can be moved (resume on loadedmetadata)
  const metadata = () => { audio.readyState = 1; p.onMeta(); };
  return { ...p, audio, rec, calls, metadata };
}
const settle = () => new Promise((r) => setImmediate(r));

test('the code under test is the player\'s own', () => {
  assert.match(PREV, /seekAudio\(0\)/);
  // Neither going back to the start nor reading the file again counts a listen or adds to the history
  for (const src of [SEEK, RELOAD, PREV]) {
    assert.doesNotMatch(src, /countedListen|increment_listens|addToHistory/);
  }
  // The only listen counted is in 'playing', once per track (playTrack resets it)
  assert.match(main, /if \(currentTrack && countedListen !== currentTrack\.id\) \{\n\s+countedListen = currentTrack\.id;/);
});

test('connection fine, part way: back to 0 in the same file', () => {
  const p = player({ at: 120 });
  p.playPrev();
  assert.equal(p.audio.currentTime, 0);
  assert.equal(p.rec.pos, 0);
  assert.equal(p.calls.reload, 0);
  assert.deepEqual(p.calls.playTrack, []);
  assert.equal(p.index(), 1);
});

test('connection fine, in its first 3 seconds: the previous track', () => {
  const p = player({ at: 2 });
  p.playPrev();
  assert.deepEqual(p.calls.playTrack, [1]);
  assert.equal(p.index(), 0);
  assert.equal(p.calls.reload, 0);
});

test('the first track of the queue: back to its start, whatever the time', () => {
  const p = player({ at: 1, index: 0 });
  p.playPrev();
  assert.equal(p.audio.currentTime, 0);
  assert.deepEqual(p.calls.playTrack, []);
});

test('paused, connection fine: back to 0 and still paused', () => {
  const p = player({ at: 120, paused: true });
  p.playPrev();
  assert.equal(p.audio.currentTime, 0);
  assert.equal(p.audio.paused, true);
  assert.equal(p.calls.play, 0);
  assert.equal(p.calls.reload, 0);
});

test('dropped while playing: the file again from 0, playing, not from where it stopped', async () => {
  const p = player({ at: 200, broken: true, interrupted: true, error: { code: 2 } });
  p.playPrev();
  await settle();
  assert.equal(p.calls.reload, 1);
  assert.equal(p.rec.resumeAt, 0);
  p.metadata();
  assert.equal(p.audio.currentTime, 0);
  assert.equal(p.calls.play, 1);
  assert.equal(p.rec.attempts, 0);
  assert.deepEqual(p.calls.playTrack, []); // the same track: its listen is not counted again
});

test('dropped, then paused by the listener: kept paused, and play starts it from 0', async () => {
  const p = player({ at: 200, paused: true, broken: true, interrupted: false, error: { code: 2 } });
  p.playPrev();
  await settle();
  assert.equal(p.calls.reload, 0);
  assert.equal(p.calls.play, 0);
  assert.equal(p.rec.pos, 0);
  // Play (togglePlay): a broken track is read again from rec.pos
  await p.reloadCurrent(true);
  p.metadata();
  assert.equal(p.audio.currentTime, 0);
  assert.deepEqual(p.calls.playTrack, []);
});

test('while the file is being read again (the element says 0): back to the start, not the previous track', async () => {
  const p = player({ at: 0, resumeAt: 200 });
  p.audio.readyState = 0;
  p.playPrev();
  assert.deepEqual(p.calls.playTrack, []);
  assert.equal(p.index(), 1);
  p.metadata();
  assert.equal(p.audio.currentTime, 0); // not back at 200
});

test('the progress bar moved while the file is being read again: it goes on from there', () => {
  const p = player({ at: 0, resumeAt: 200 });
  p.audio.readyState = 0;
  p.seekAudio(50);
  p.metadata();
  assert.equal(p.audio.currentTime, 50);
  assert.equal(p.rec.pos, 50);
});

test('after a reload the track still resumes where it was when nothing moved it', async () => {
  const p = player({ at: 200, broken: true, interrupted: true, error: { code: 2 } });
  await p.reloadCurrent(true);
  p.metadata();
  assert.equal(p.audio.currentTime, 200);
});
