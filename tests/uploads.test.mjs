// What the upload page reads from a file: its title, reciter and category, as a
// person would (the same cases as the phone app's TrackGuessTest). npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixTag, cleanTitle, guess, category, dbCategory, duration } from '../src/uploads.js';

const r = (name, count = 40) => ({ name, count });
const library = [r('باسم الكربلائي', 300), r('سيد فاقد الموسوي', 120), r('علي الدلفي', 90), r('حسين فيصل', 60), r('علي', 2)];
const english = { 'basim karbalaei': 'باسم الكربلائي' };
const translate = (n) => english[n.toLowerCase().trim()] || n;
const g = (file, { title = null, artist = null, album = null, genre = null } = {}) =>
  guess(file, title && fixTag(title), artist && fixTag(artist), album, genre, library, translate);

test('Arabic tags written in the Windows code page', () => {
  // "باسم الكربلائي" saved by an old tag editor, read back as Latin letters
  const bytes = [0xC8, 0xC7, 0xD3, 0xE3, 0x20, 0xC7, 0xE1, 0xDF, 0xD1, 0xC8, 0xE1, 0xC7, 0xC6, 0xED];
  assert.equal(fixTag(String.fromCharCode(...bytes)), 'باسم الكربلائي');
  assert.equal(fixTag('Café'), 'Café');
  assert.equal(fixTag('  يا حسين\u0000'), 'يا حسين');
});

test('file names cleaned', () => {
  assert.equal(cleanTitle('01 - يا حسين (Official Video) www.example.com.mp3'), 'يا حسين');
  assert.equal(cleanTitle('منو_اليسند [حصرياً 2024].m4a'), 'منو اليسند');
  assert.equal(cleanTitle('14 صفر.mp3'), '14 صفر');
});

test('reciter and title from the file name', () => {
  assert.deepEqual(g('باسم الكربلائي - يا حسين.mp3'), { title: 'يا حسين', reciter: 'باسم الكربلائي', category: 'hussainiya', fromTags: false });
  assert.deepEqual(g('يا زهراء - سيد فاقد الموسوي.mp3'), { title: 'يا زهراء', reciter: 'سيد فاقد الموسوي', category: 'hussainiya', fromTags: false });
  assert.equal(g('الملا باسم الكربلائى - ذبحوك.mp3').reciter, 'باسم الكربلائي');
  // A reciter new to the library, marked by "الرادود" (left out of their name)
  assert.deepEqual(g('الرادود حيدر العطار - لبيك.mp3'), { title: 'لبيك', reciter: 'حيدر العطار', category: 'hussainiya', fromTags: false });
});

test('tags first', () => {
  assert.deepEqual(g('AUD-20240101-WA0012.mp3', { title: 'منو اليسند', artist: 'الرادود باسم الكربلائي' }),
    { title: 'منو اليسند', reciter: 'باسم الكربلائي', category: 'hussainiya', fromTags: true });
  assert.deepEqual(g('PTT-20240301.ogg', { title: 'حب حيدر - سيد فاقد الموسوي' }),
    { title: 'حب حيدر', reciter: 'سيد فاقد الموسوي', category: 'hussainiya', fromTags: true });
  assert.equal(g('x.mp3', { title: 'يا علي', artist: 'Basim Karbalaei' }).reciter, 'باسم الكربلائي');
  // A one-word name is not taken for "علي الدلفي"
  assert.equal(g('علي.mp3').reciter, '');
});

test('nothing to read leaves it to them', () => {
  assert.deepEqual(g('AUD-20240101-WA0012.mp3'), { title: '', reciter: '', category: 'hussainiya', fromTags: false });
  assert.equal(g('rec.mp3', { artist: 'Unknown Artist' }).reciter, '');
});

test('category from its words', () => {
  assert.equal(category('مولد الإمام علي'), 'muwalid');
  assert.equal(category('أفراح الغدير'), 'muwalid');
  assert.equal(category('دعاء كميل'), 'dua');
  assert.equal(category('زيارة عاشوراء'), 'ziyarat');
  assert.equal(category('سورة يس'), 'quran');
  assert.equal(category('نعي الزهراء'), 'naei');
  // The wedding of al-Qasim is a Muharram poem
  assert.equal(category('عرس القاسم'), 'hussainiya');
  assert.equal(category('يا حسين'), 'hussainiya');
  assert.equal(dbCategory('hussainiya'), 'hussainiya_poems');
});

test('lengths', () => {
  assert.equal(duration(125000), '2:05');
  assert.equal(duration(3725000), '1:02:05');
  assert.equal(duration(null), '0:00');
});
