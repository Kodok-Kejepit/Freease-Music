// Proxy video & gambar Freease Stream. Banyak tautan video terikat IP server (Blogger, OK.ru) dan gambar komik
// butuh Referer tertentu, jadi browser mengambilnya lewat sini. Hanya URL yang ditandatangani server ini yang
// dilayani (HMAC), jadi ini bukan proxy terbuka.
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { UA_DESKTOP } from './net.js';

const LANG = 'id-ID,id;q=0.9,en;q=0.8';
const KEY = process.env.FREEASE_SECRET || crypto.randomBytes(32).toString('hex');
const b64 = (s) => Buffer.from(s).toString('base64url');
const unb64 = (s) => Buffer.from(String(s), 'base64url').toString();
const sign = (...parts) => crypto.createHmac('sha256', KEY).update(parts.join('\n')).digest('base64url').slice(0, 22);

/** URL lokal untuk video [url] (dengan Referer opsional). */
export function mediaUrl(url, referer = '') {
  return `/api/fs/media?u=${b64(url)}${referer ? `&r=${b64(referer)}` : ''}&s=${sign('m', url, referer)}`;
}
/** URL lokal untuk daftar putar HLS [url]: isinya ditulis ulang supaya tiap potongan juga lewat proxy ini. */
export function hlsUrl(url, referer = '') {
  return `/api/fs/hls?u=${b64(url)}${referer ? `&r=${b64(referer)}` : ''}&s=${sign('h', url, referer)}`;
}
/** URL lokal untuk gambar [url]; tanpa tanda tangan bila kosong. */
export function imgUrl(url, referer = '') {
  if (!url) return null;
  return `/api/fs/img?u=${b64(url)}${referer ? `&r=${b64(referer)}` : ''}&s=${sign('i', url, referer)}`;
}

function verify(kind, q) {
  try {
    const url = unb64(q.u || '');
    const referer = q.r ? unb64(q.r) : '';
    const want = sign(kind, url, referer);
    const got = String(q.s || '');
    if (got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) return null;
    if (!/^https?:\/\//.test(url)) return null;
    return { url, referer };
  } catch { return null; }
}

const PASS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];

async function pipe(req, res, target, { image }) {
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  // Header sama dengan saat halaman pemutar dibuka (fetchText): beberapa token CDN terikat ke sidik header ini.
  const headers = { 'user-agent': UA_DESKTOP, 'accept-language': LANG, accept: image ? 'image/avif,image/webp,image/*,*/*;q=0.8' : '*/*' };
  if (target.referer) headers.referer = target.referer;
  if (!image && req.headers.range) headers.range = req.headers.range;
  let up;
  try {
    up = await fetch(target.url, { headers, redirect: 'follow', signal: ac.signal });
  } catch {
    if (!res.headersSent) res.status(502).end();
    return;
  }
  const type = up.headers.get('content-type') || '';
  if (!up.ok && up.status !== 206) { res.status(up.status === 404 || up.status === 410 ? 404 : 502).end(); ac.abort(); return; }
  if (image && !/^image\//.test(type) && !/octet-stream/.test(type)) { res.status(415).end(); ac.abort(); return; }
  if (image && Number(up.headers.get('content-length') || 0) > 20 * 1024 * 1024) { res.status(413).end(); ac.abort(); return; }
  res.status(up.status);
  for (const h of PASS) { const v = up.headers.get(h); if (v) res.setHeader(h, v); }
  if (!image && !/^video\/|mp2t|mpegurl/.test(type)) res.setHeader('content-type', 'video/mp4');
  res.setHeader('cache-control', image ? 'private, max-age=604800, immutable' : 'private, max-age=3600');
  if (!up.body) { res.end(); return; }
  Readable.fromWeb(up.body).on('error', () => res.destroy()).pipe(res);
}

/** Daftar putar m3u8: URI di dalamnya (varian, potongan, kunci, peta) diganti URL proxy bertanda tangan. */
async function playlist(req, res, t) {
  let up;
  try {
    up = await fetch(t.url, { headers: { 'user-agent': UA_DESKTOP, 'accept-language': LANG, ...(t.referer ? { referer: t.referer, origin: t.referer.replace(/\/$/, '') } : {}) }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
  } catch { return res.status(502).end(); }
  const text = up.ok ? await up.text() : '';
  if (!text.trimStart().startsWith('#EXTM3U')) return res.status(up.status === 404 ? 404 : 502).end();
  const base = up.url || t.url;
  const abs = (u) => { try { return new URL(u, base).href; } catch { return u; } };
  const master = /#EXT-X-STREAM-INF/.test(text);
  const out = text.split(/\r?\n/).map((line) => {
    const l = line.trim();
    if (!l) return l;
    if (l.startsWith('#')) {
      const sub = /^#EXT-X-(MEDIA|I-FRAME-STREAM-INF)/.test(l);
      return l.replace(/URI="([^"]+)"/g, (_, u) => `URI="${sub ? hlsUrl(abs(u), t.referer) : mediaUrl(abs(u), t.referer)}"`);
    }
    return master ? hlsUrl(abs(l), t.referer) : mediaUrl(abs(l), t.referer);
  }).join('\n');
  res.setHeader('content-type', 'application/vnd.apple.mpegurl');
  res.setHeader('cache-control', 'private, max-age=60');
  res.send(out);
}

/** Pasang rute proxy ke aplikasi Express. */
export function mountMedia(app) {
  app.get('/api/fs/media', (req, res) => {
    const t = verify('m', req.query);
    if (!t) return res.status(403).json({ error: 'Tautan video tidak sah atau kedaluwarsa' });
    pipe(req, res, t, { image: false });
  });
  app.get('/api/fs/hls', (req, res) => {
    const t = verify('h', req.query);
    if (!t) return res.status(403).json({ error: 'Tautan video tidak sah atau kedaluwarsa' });
    playlist(req, res, t);
  });
  app.get('/api/fs/img', (req, res) => {
    const t = verify('i', req.query);
    if (!t) return res.status(403).end();
    pipe(req, res, t, { image: true });
  });
}
