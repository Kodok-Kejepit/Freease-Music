// Pembongkar pemutar berisi iklan: JS terkemas dibuka dan daftar putar HLS ditulis ulang lewat proxy bertanda tangan.
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { unpack } from '../src/fuwa/hosts.js';
import { hlsUrl, mountMedia } from '../src/fuwa/media.js';

test('unpack membuka JS terkemas (p,a,c,k,e,d)', () => {
  const packed = "eval(function(p,a,c,k,e,d){return p}('0({1:\"2://3.4/5.6\"})',7,7,'setup|file|https|cdn|example|master|m3u8'.split('|'),0,{}))";
  assert.equal(unpack(packed), 'setup({file:"https://cdn.example/master.m3u8"})');
  assert.equal(unpack('bukan kemasan'), null);
});

test('daftar putar master & potongan ditulis ulang ke proxy, URL relatif diselesaikan', async () => {
  const up = express();
  up.get('/v/master.m3u8', (req, res) => res.type('application/vnd.apple.mpegurl').send('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1280x720\n720/index.m3u8\n'));
  up.get('/v/720/index.m3u8', (req, res) => res.send('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:4,\nseg1.ts\n#EXT-X-ENDLIST\n'));
  const s1 = up.listen(0);
  const base = `http://127.0.0.1:${s1.address().port}`;
  const app = express();
  mountMedia(app);
  const s2 = app.listen(0);
  const me = `http://127.0.0.1:${s2.address().port}`;
  try {
    const m = await (await fetch(me + hlsUrl(`${base}/v/master.m3u8`, 'https://pemutar.contoh/'))).text();
    const variant = m.split('\n').find((l) => l && !l.startsWith('#'));
    assert.match(variant, /^\/api\/fs\/hls\?u=/);
    const v = await (await fetch(me + variant)).text();
    assert.match(v, /URI="\/api\/fs\/media\?u=/);
    const seg = v.split('\n').find((l) => l && !l.startsWith('#'));
    assert.match(seg, /^\/api\/fs\/media\?u=/);
    const u = Buffer.from(new URL('http://x' + seg).searchParams.get('u'), 'base64url').toString();
    assert.equal(u, `${base}/v/720/seg1.ts`);
    assert.equal((await fetch(me + '/api/fs/hls?u=AAAA&s=salah')).status, 403);
  } finally { s1.close(); s2.close(); }
});
