// Proxy video & gambar Freease Stream. Banyak tautan video terikat IP server (Blogger, OK.ru) dan gambar komik
// butuh Referer tertentu, jadi browser mengambilnya lewat sini. Hanya URL yang ditandatangani server ini yang
// dilayani (HMAC), jadi ini bukan proxy terbuka.
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { UA_DESKTOP } from './net.js';

const KEY = process.env.FREEASE_SECRET || crypto.randomBytes(32).toString('hex');
const b64 = (s) => Buffer.from(s).toString('base64url');
const unb64 = (s) => Buffer.from(String(s), 'base64url').toString();
const sign = (...parts) => crypto.createHmac('sha256', KEY).update(parts.join('\n')).digest('base64url').slice(0, 22);

/** URL lokal untuk video [url] (dengan Referer opsional). */
export function mediaUrl(url, referer = '') {
  return `/api/fs/media?u=${b64(url)}${referer ? `&r=${b64(referer)}` : ''}&s=${sign('m', url, referer)}`;
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
  const headers = { 'user-agent': UA_DESKTOP, accept: image ? 'image/avif,image/webp,image/*,*/*;q=0.8' : '*/*' };
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

/** Pasang rute proxy ke aplikasi Express. */
export function mountMedia(app) {
  app.get('/api/fs/media', (req, res) => {
    const t = verify('m', req.query);
    if (!t) return res.status(403).json({ error: 'Tautan video tidak sah atau kedaluwarsa' });
    pipe(req, res, t, { image: false });
  });
  app.get('/api/fs/img', (req, res) => {
    const t = verify('i', req.query);
    if (!t) return res.status(403).end();
    pipe(req, res, t, { image: true });
  });
}
