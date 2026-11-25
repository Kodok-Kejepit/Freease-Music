// Freease Stream: helper teks, tanda tangan proxy media (bukan proxy terbuka), dan rute sumber komik.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlText, sameTitle, decodeEntities } from '../src/fuwa/net.js';
import { mediaUrl, imgUrl, mountMedia } from '../src/fuwa/media.js';
import * as M from '../src/fuwa/manga.js';

test('htmlText merapikan HTML sumber', () => {
  assert.equal(htmlText('Halo<br>dunia &amp; <b>kamu</b>&#8230;'), 'Halo\ndunia & kamu…');
  assert.equal(decodeEntities('&#x1F600;'), '\u{1F600}');
  assert.ok(sameTitle('Mu Shen Ji', 'Mushen Ji!'));
  assert.ok(!sameTitle('Love', 'Lovely', ['Love Story']));
});

test('URL media ditandatangani dan tidak bisa dipalsukan', async () => {
  const routes = {};
  mountMedia({ get: (p, h) => { routes[p] = h; } });
  const call = (path) => new Promise((resolve) => {
    const q = Object.fromEntries(new URL('http://x' + path).searchParams);
    const res = { status(c) { this.code = c; return this; }, json() { resolve(this.code); }, end() { resolve(this.code); }, on() {} };
    routes[path.split('?')[0]]({ query: q, headers: {} }, res);
  });
  const good = mediaUrl('https://contoh.invalid/a.mp4');
  assert.match(good, /^\/api\/fs\/media\?u=.+&s=.+/);
  const forged = good.replace(/u=[^&]+/, 'u=' + Buffer.from('http://127.0.0.1:22/').toString('base64url'));
  assert.equal(await call(forged), 403);
  const asImage = imgUrl('https://contoh.invalid/a.mp4').replace('/api/fs/img', '/api/fs/media');
  assert.equal(await call(asImage), 403, 'tanda tangan gambar tidak berlaku untuk video');
  assert.equal(imgUrl(null), null);
});

test('id komik ditolak bila sumbernya tidak dikenal', async () => {
  await assert.rejects(() => M.detail('xx:apa'), /tidak valid/);
  await assert.rejects(() => M.browse('zz', {}), /tidak dikenal/);
  assert.deepEqual(M.SOURCE_LIST.map((s) => s.key), ['km', 'sh', 'ki', 'bk', 'wt', 'mp', 'kk']);
});

test('sumber anime dipilih dari awalan ID, ID asing ditolak', async () => {
  const OD = await import('../src/fuwa/otakudesu.js');
  const AC = await import('../src/fuwa/anichin.js');
  assert.ok(OD.own('od:abc') && !OD.own('abc') && AC.own('ac:abc') && !AC.own('od:abc'));
  await assert.rejects(() => AC.detail('ac:../etc'), /tidak valid/);
  await assert.rejects(() => OD.detail('od:a b'), /tidak valid/);
});

test('embed cuma untuk host yang diuji di sandbox; berkas langsung selalu didahulukan', async () => {
  const { embedSource, sortSources } = await import('../src/fuwa/embed.js');
  assert.equal(embedSource('https://player.abyssplayer.com/x1')[0].type, 'embed');
  assert.equal(embedSource('https://mega.nz/embed/abc#k')[0].label, 'MEGA');
  assert.deepEqual(embedSource('https://morencius.com/embed/x'), []);
  assert.deepEqual(embedSource('http://player.abyssplayer.com/x1'), []);
  assert.deepEqual(embedSource('https://mega.nz/file/abc'), []);
  const out = sortSources([{ type: 'embed', quality: 'Auto' }, { type: 'mp4', quality: '360p' }, { type: 'mp4', quality: '1080p' }]);
  assert.deepEqual(out.map((s) => s.quality), ['1080p', '360p', 'Auto']);
});
