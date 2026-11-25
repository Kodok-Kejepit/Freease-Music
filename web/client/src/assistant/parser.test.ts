import { describe, expect, it } from 'vitest';
import { parse } from './parser';

describe('parser perintah suara', () => {
  const cases: [string, unknown, boolean?][] = [
    ['oke freease, putar lagu yang sudah di download', { type: 'playDownloads' }],
    ['putar tulus', { type: 'play', query: 'tulus' }],
    ['tulus', { type: 'play', query: 'tulus' }, true],
    ['cari hindia', { type: 'search', query: 'hindia' }],
    ['lagu berikutnya', { type: 'next' }],
    ['buka beranda', { type: 'open', page: 'home' }],
    ['pergi ke koleksi', { type: 'open', page: 'library' }],
    ['buka hasil download', { type: 'open', page: 'downloads' }],
    ['buka rekap tahunan', { type: 'open', page: 'stats' }],
    ['buka playlist santai sore', { type: 'openPlaylist', name: 'santai sore' }],
    ['kembali', { type: 'back' }],
    ['nyalakan karaoke', { type: 'karaoke', on: true }],
    ['timer tidur 30 menit', { type: 'sleep', minutes: 30 }],
    ['matikan musik dalam satu jam', { type: 'sleep', minutes: 60 }],
    ['yang lain dong', { type: 'more' }],
    ['yang tadi lagi', { type: 'again' }],
    ['putar lagu buat belajar', { type: 'mood', mood: 'STUDY' }],
    ['lagu galau', { type: 'mood', mood: 'SAD' }],
    ['putar cinta luar biasa', { type: 'play', query: 'cinta luar biasa' }],
    ['putar playlist santai', { type: 'playPlaylist', name: 'santai' }],
    ['aku dengerin apa aja hari ini', { type: 'summary', days: 1 }],
    ['oke freease', null],
  ];
  for (const [text, expected, wake] of cases) {
    it(text, () => expect(parse(text, wake ?? true)).toEqual(expected));
  }
});
