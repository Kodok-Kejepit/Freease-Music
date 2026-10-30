import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { proxy, _setResolverForTest } from '../src/stream.js';
import { splitTitle } from '../src/lyrics.js';
import { mapMusicItem } from '../src/youtube.js';

const DATA = Buffer.alloc(10_000, 7);

function listen(app) {
  return new Promise((r) => { const s = app.listen(0, () => r(s)); });
}

test('proxy meneruskan Range dan mencoba ulang saat URL kedaluwarsa', async () => {
  let calls = 0;
  const upstream = http.createServer((req, res) => {
    calls++;
    if (req.url.includes('expired')) { res.statusCode = 403; return res.end(); }
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (m) {
      const a = Number(m[1]); const b = m[2] ? Number(m[2]) : DATA.length - 1;
      res.writeHead(206, { 'content-type': 'audio/webm', 'content-range': `bytes ${a}-${b}/${DATA.length}`, 'content-length': b - a + 1, 'accept-ranges': 'bytes' });
      return res.end(DATA.subarray(a, b + 1));
    }
    res.writeHead(200, { 'content-type': 'audio/webm', 'content-length': DATA.length });
    res.end(DATA);
  });
  await new Promise((r) => upstream.listen(0, r));
  const base = `http://127.0.0.1:${upstream.address().port}`;
  let first = true;
  _setResolverForTest(async () => {
    const url = first ? `${base}/expired` : `${base}/ok`;
    first = false;
    return { url, mime: 'audio/webm', headers: {} };
  });
  const app = express();
  app.get('/s/:id', (req, res) => proxy(req.params.id, req, res));
  const srv = await listen(app);
  const r = await fetch(`http://127.0.0.1:${srv.address().port}/s/abcdefgh`, { headers: { Range: 'bytes=100-199' } });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-range'), `bytes 100-199/${DATA.length}`);
  assert.equal((await r.arrayBuffer()).byteLength, 100);
  assert.equal(calls, 2);
  srv.close(); upstream.close();
});

test('judul video dipisah jadi artis & judul untuk mencari lirik', () => {
  assert.deepEqual(splitTitle('TULUS - Monokrom (Official Music Video)', 'Tulus Official'), { artist: 'TULUS', title: 'Monokrom (Official Music Video)' });
  assert.deepEqual(splitTitle('Monokrom', 'Tulus'), { artist: 'Tulus', title: 'Monokrom' });
});

test('item YouTube Music dibaca dari kolom teks', () => {
  const s = mapMusicItem({
    id: 'abcdefghijk',
    flex_columns: [
      { title: { toString: () => 'Hati-Hati di Jalan', runs: [] } },
      { title: { toString: () => 'Lagu • Tulus • Manusia • 4:02', runs: [{ text: 'Tulus', endpoint: { payload: { browseId: 'UCabc' } } }] } },
    ],
  });
  assert.equal(s.title, 'Hati-Hati di Jalan');
  assert.equal(s.artist, 'Tulus');
  assert.equal(s.artistId, 'UCabc');
  assert.equal(s.album, 'Manusia');
  assert.equal(s.duration, 242);
});

import { rankVideos } from '../src/youtube.js';
test('hasil video diurutkan seperti hasil lagu', () => {
  const list = [
    { id: 'a', title: 'Tulus - Monokrom | Lirik Lagu', artist: 'Indolirik', duration: 330 },
    { id: 'b', title: 'TULUS - Monokrom (Official Music Video)', artist: 'Tulus', duration: 339 },
    { id: 'c', title: 'TOP HITS 2026 Playlist Lagu Indonesia', artist: 'Mix', duration: 3600 },
  ];
  const r = rankVideos('tulus monokrom', list, true);
  assert.deepEqual(r.map((s) => s.id), ['b', 'a']);
});

import { diagnose } from '../src/stream.js';
test('diagnosa butuh minimal 2 dari 3 lagu uji', async () => {
  const srv = http.createServer((req, res) => { res.writeHead(206, { 'content-range': 'bytes 0-9/10' }); res.end('0123456789'); });
  await new Promise((r) => srv.listen(0, r));
  const ok = `http://127.0.0.1:${srv.address().port}/a`;
  let n = 0;
  _setResolverForTest(async () => { if (n++ === 0) return { url: ok, mime: 'audio/webm', headers: {} }; throw Object.assign(new Error('Sign in to confirm'), { blocked: true }); });
  const bad = await diagnose(['a1aaaaaaaaa', 'b1bbbbbbbbb', 'c1ccccccccc']);
  assert.equal(bad.ok, false);
  assert.equal(bad.passed, 1);
  _setResolverForTest(async () => ({ url: ok, mime: 'audio/webm', headers: {} }));
  const good = await diagnose(['a2aaaaaaaaa', 'b2bbbbbbbbb', 'c2ccccccccc']);
  assert.equal(good.ok, true);
  srv.close();
});

test('format yt-dlp dipilah & dipilih sesuai kualitas/codec', async () => {
  const { formatsFromYtdlp, pickAudio, pickVideo } = await import('../src/stream.js');
  const f = (id, o) => ({ format_id: id, url: `https://x/${id}`, protocol: 'https', ...o });
  const e = formatsFromYtdlp({ formats: [
    f('251', { ext: 'webm', acodec: 'opus', vcodec: 'none', abr: 129 }),
    f('140', { ext: 'm4a', acodec: 'mp4a.40.2', vcodec: 'none', abr: 129.5 }),
    f('249', { ext: 'webm', acodec: 'opus', vcodec: 'none', abr: 46 }),
    f('136', { ext: 'mp4', acodec: 'none', vcodec: 'avc1.4d401f', height: 720 }),
    f('137', { ext: 'mp4', acodec: 'none', vcodec: 'avc1.640028', height: 1080 }),
    f('248', { ext: 'webm', acodec: 'none', vcodec: 'vp9', height: 1080 }),
    f('313', { ext: 'webm', acodec: 'none', vcodec: 'vp9', height: 2160 }),
    { format_id: '232', url: 'https://x/hls', protocol: 'm3u8_native', vcodec: 'avc1', acodec: 'none', height: 720 },
  ] });
  assert.equal(pickAudio(e).url, 'https://x/251', 'opus diutamakan walau bitrate AAC sedikit lebih tinggi');
  assert.equal(pickAudio(e, 'high', true).url, 'https://x/140', 'browser tanpa opus → AAC');
  assert.equal(pickAudio(e, 'low').url, 'https://x/249');
  assert.equal(pickVideo(e, 720, ['avc1']).url, 'https://x/136');
  assert.equal(pickVideo(e, 1080, ['vp9', 'avc1']).url, 'https://x/248');
  assert.equal(pickVideo(e, 2160, ['avc1']).url, 'https://x/137', 'H.264 maksimal 1080p');
  assert.equal(pickVideo(e, 2160, ['vp9', 'avc1']).url, 'https://x/313');
  assert.equal(pickVideo(e, 144, ['avc1']).url, 'https://x/136', 'tidak ada yang cukup kecil → yang terkecil');
  assert.ok(!e.video.some((v) => v.url === 'https://x/hls'), 'HLS dilewati');
});

test('subtitle json3 YouTube dibaca jadi potongan berwaktu', async () => {
  const { parseJson3 } = await import('../src/captions.js');
  const cues = parseJson3({ events: [
    { tStartMs: 1000, dDurationMs: 4000, segs: [{ utf8: 'Halo' }, { utf8: ' dunia' }] },
    { tStartMs: 3000, dDurationMs: 2000, segs: [{ utf8: '\n' }] },
    { tStartMs: 3500, dDurationMs: 2000, segs: [{ utf8: 'baris  kedua' }] },
    { tStartMs: 9000 },
  ] });
  assert.deepEqual(cues, [{ s: 1, e: 3.5, t: 'Halo dunia' }, { s: 3.5, e: 5.5, t: 'baris kedua' }]);
});
