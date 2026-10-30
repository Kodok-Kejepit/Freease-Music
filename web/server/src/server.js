// Server Freease Web: API (cari, info, radio, artis, playlist, lirik, stream) + aplikasi web hasil build.
import express from 'express';
import crypto from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Y from './youtube.js';
import { diagnose, proxy, resolve, streamStatus } from './stream.js';
import { lyrics } from './lyrics.js';
import { captions } from './captions.js';
import { translateLines } from './translate.js';
import { limiter, rateLimit, securityHeaders } from './guard.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const PASSWORD = process.env.FREEASE_PASSWORD || '';
const SECRET = process.env.FREEASE_SECRET || crypto.randomBytes(32).toString('hex');
const CLIENT_DIR = process.env.CLIENT_DIR || path.resolve(here, '../../client/dist');
const VOICE_DIR = process.env.VOICE_DIR || path.resolve(here, '../../../android/app/src/main/assets/voice_dev');

const app = express();
app.disable('x-powered-by');
// Hanya percayai X-Forwarded-For dari proxy di mesin/jaringan Docker sendiri (Caddy), supaya IP asli
// pengunjung tidak bisa dipalsukan untuk menghindari batas permintaan.
const TRUST = process.env.TRUST_PROXY ?? 'loopback, linklocal, uniquelocal';
app.set('trust proxy', TRUST === 'false' ? false : TRUST);
app.use(securityHeaders);
app.use(rateLimit({ windowMs: 60_000, max: Number(process.env.RATE_LIMIT_PER_MIN || 600) }));
app.use(express.json({ limit: '100kb' }));

// ---------------------------------------------------------------- kata sandi (opsional)
// Server pribadi: set FREEASE_PASSWORD supaya kuota bandwidth tidak dipakai orang lain.
const token = () => crypto.createHmac('sha256', SECRET).update(PASSWORD).digest('hex');
const authed = (req) => !PASSWORD || (req.headers.cookie || '').split(/;\s*/).includes(`freease_auth=${token()}`);

app.get('/api/config', (req, res) => {
  const voice = existsSync(VOICE_DIR) ? readdirSync(VOICE_DIR).filter((f) => /\.(ogg|opus|m4a|mp3)$/.test(f)) : [];
  res.json({ needsPassword: !!PASSWORD, authed: authed(req), voice, version: '1.7.1' });
});

// Kunci sementara setelah 8 kali salah dalam 15 menit (per IP) — menghentikan tebak-tebakan kata sandi.
const loginFails = limiter({ windowMs: 15 * 60_000, max: 7 }); // salah ke-8 → terkunci
app.post('/api/login', (req, res) => {
  const wait = loginFails.blocked(req.ip);
  if (wait) return res.status(429).json({ error: `Terlalu banyak percobaan. Coba lagi ${Math.ceil(wait / 60)} menit lagi` });
  const ok = !PASSWORD || (typeof req.body?.password === 'string' &&
    crypto.timingSafeEqual(crypto.createHash('sha256').update(req.body.password).digest(), crypto.createHash('sha256').update(PASSWORD).digest()));
  if (!ok) { loginFails.hit(req.ip); return res.status(401).json({ error: 'Kata sandi salah' }); }
  loginFails.reset(req.ip);
  res.setHeader('Set-Cookie', `freease_auth=${token()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${req.secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});

// Pengunjung yang belum masuk hanya boleh sedikit permintaan (mengurangi beban dari pemindai/bot).
const guestApi = limiter({ windowMs: 60_000, max: 60 });
app.use('/api', (req, res, next) => {
  if (authed(req)) return next();
  if (guestApi.hit(req.ip)) return res.status(429).json({ error: 'Terlalu banyak permintaan' });
  res.status(401).json({ error: 'Perlu masuk dulu' });
});
app.use('/voice', (req, res, next) => (authed(req) ? next() : res.status(401).end()), express.static(VOICE_DIR, { maxAge: '7d' }));

// ---------------------------------------------------------------- API
const wrap = (fn) => async (req, res) => {
  try {
    const out = await fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e) {
    // Tanpa query string: kata kunci pencarian pengguna tidak ikut tercatat di log server.
    console.error(req.method, req.path, e.message);
    if (!res.headersSent) res.removeHeader('cache-control'); // galat jangan sampai disimpan browser
    if (!res.headersSent) res.status(e.status || (e.blocked ? 503 : 500)).json({ error: e.message, blocked: !!e.blocked });
    else res.destroy();
  }
};

const ID = /^[A-Za-z0-9_-]{6,64}$/;
const needId = (req) => {
  if (!ID.test(req.params.id)) throw Object.assign(new Error('ID tidak valid'), { status: 400 });
  return req.params.id;
};

app.get('/api/search', wrap(async (req, res) => {
  const next = String(req.query.next || '');
  if (next) { res.setHeader('cache-control', 'private, max-age=600'); return Y.searchMore(next.slice(0, 40)); }
  const q = String(req.query.q || '').trim().slice(0, 200);
  if (!q) return { songs: [] };
  res.setHeader('cache-control', 'private, max-age=600');
  return Y.search(q, String(req.query.type || 'songs'));
}));
app.get('/api/suggest', wrap(async (req, res) => {
  res.setHeader('cache-control', 'private, max-age=3600');
  return Y.suggest(String(req.query.q || '').slice(0, 100), req.query.src === 'youtube' ? 'youtube' : 'music');
}));
app.get('/api/song/:id', wrap(async (req, res) => { res.setHeader('cache-control', 'private, max-age=600'); return Y.song(needId(req)); }));
app.get('/api/related/:id', wrap(async (req, res) => { res.setHeader('cache-control', 'private, max-age=600'); return Y.related(needId(req), req.query.src === 'youtube' ? 'youtube' : 'music'); }));
app.get('/api/artist/:id', wrap(async (req, res) => { res.setHeader('cache-control', 'private, max-age=1800'); return Y.artist(needId(req)); }));
app.get('/api/playlist/:id', wrap(async (req, res) => { res.setHeader('cache-control', 'private, max-age=600'); return Y.playlist(needId(req)); }));
app.get('/api/lyrics', wrap(async (req, res) => {
  const l = await lyrics({
    id: ID.test(String(req.query.id || '')) ? String(req.query.id) : null,
    title: String(req.query.title || '').slice(0, 200),
    artist: String(req.query.artist || '').slice(0, 200),
    duration: Number(req.query.duration) || 0,
  });
  // Ketemu → browser boleh menyimpannya sehari; tidak ketemu → cepat dicoba lagi.
  res.setHeader('cache-control', `private, max-age=${l.synced || l.plain ? 86400 : 600}`);
  return l;
}));
// Tes & status mesin hanya untuk pemilik server (dari VPS sendiri, mis. install.sh) — tidak untuk pengunjung:
// diagnosa menjalankan yt-dlp 3 kali, jadi bisa dipakai membebani server.
const internal = (req) => !req.headers['x-forwarded-for'] && /^(127\.|::1$|::ffff:127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::ffff:(10|172|192)\.)/.test(req.socket.remoteAddress || '');
const ownerOnly = (fn) => async (req, res) => (internal(req) ? fn(req, res) : { error: 'Hanya bisa dari server' });
app.get('/api/status', wrap(ownerOnly(async () => streamStatus())));
app.get('/api/diagnose', wrap(ownerOnly(async () => {
  const d = await diagnose();
  // Subtitle & terjemahan Indonesia diambil dari server subtitle YouTube yang kadang memblokir IP server.
  try { d.subtitles = (await captions('kJQP7kiw5Fk', 'id')).cues.length > 0; } catch (e) { d.subtitles = false; d.subtitlesError = e.message; }
  return d;
})));

/** Cek cepat apakah server bisa mengambil audio lagu ini (dipakai klien untuk memilih mode putar). */
app.get('/api/playable/:id', wrap(async (req) => {
  try {
    await resolve(needId(req));
    return { ok: true };
  } catch (e) {
    return { ok: false, blocked: !!e.blocked, error: e.message };
  }
}));
app.get('/api/stream/:id', wrap(async (req, res) => {
  await proxy(needId(req), req, res, { kind: 'audio', quality: req.query.q === 'low' ? 'low' : 'high', m4a: req.query.f === 'm4a' });
}));
const CODECS = ['av01', 'vp9', 'avc1'];
const codecsOf = (q) => {
  const list = String(q || '').split(',').filter((c) => CODECS.includes(c));
  return list.length ? list : ['avc1'];
};
/** Video tanpa suara (disinkronkan dengan audio di browser). h = tinggi maks., c = codec yang didukung browser. */
app.get('/api/video/:id', wrap(async (req, res) => {
  const h = Math.min(2160, Math.max(144, Number(req.query.h) || 720));
  await proxy(needId(req), req, res, { kind: 'video', height: h, codecs: codecsOf(req.query.c) });
}));
/** Info video: deskripsi, suka, subscriber, tanggal, bab, dan subtitle yang tersedia. */
app.get('/api/videoinfo/:id', wrap(async (req, res) => {
  const m = (await resolve(needId(req))).meta || {};
  res.setHeader('cache-control', 'private, max-age=3600');
  return {
    description: m.description || '', likes: m.likes ?? null, subscribers: m.subscribers ?? null, uploadDate: m.uploadDate ?? null,
    chapters: m.chapters || [], captions: (m.captions || []).map(({ lang, name, kind }) => ({ lang, name, kind })),
  };
}));
/** Subtitle: ?lang=id (Indonesia, diterjemahkan bila perlu) | orig | kode bahasa. */
app.get('/api/captions/:id', wrap(async (req, res) => {
  const lang = /^[a-zA-Z-]{2,12}$/.test(String(req.query.lang || '')) ? String(req.query.lang) : 'id';
  const r = await captions(needId(req), lang);
  res.setHeader('cache-control', 'private, max-age=86400');
  return r;
}));
/** Terjemahkan teks (judul, deskripsi, lirik) — maks. 400 baris / 20.000 karakter per permintaan. */
app.post('/api/translate', wrap(async (req) => {
  const lines = Array.isArray(req.body?.lines) ? req.body.lines.slice(0, 400).map((l) => String(l).slice(0, 2000)) : [];
  if (!lines.length || lines.join('').length > 20000) throw Object.assign(new Error('Teks terlalu panjang'), { status: 400 });
  const to = /^[a-z]{2}(-[A-Z]{2})?$/.test(String(req.body?.to || '')) ? req.body.to : 'id';
  return translateLines(lines, to);
}));

/** Resolusi video yang tersedia untuk lagu ini (untuk pilihan kualitas). */
app.get('/api/formats/:id', wrap(async (req) => {
  const e = await resolve(needId(req));
  const codecs = codecsOf(req.query.c);
  return { heights: [...new Set(e.video.filter((v) => codecs.includes(v.codec)).map((v) => v.height))].sort((a, b) => a - b) };
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Tidak ada' }));

// ---------------------------------------------------------------- aplikasi web
if (existsSync(CLIENT_DIR)) {
  app.use(express.static(CLIENT_DIR, {
    maxAge: '1y',
    setHeaders: (res, p) => { if (p.endsWith('index.html') || p.endsWith('sw.js') || p.endsWith('.webmanifest')) res.setHeader('cache-control', 'no-cache'); },
  }));
  app.get('*', (req, res) => res.sendFile(path.join(CLIENT_DIR, 'index.html'), { headers: { 'cache-control': 'no-cache' } }));
}

app.listen(PORT, () => console.log(`Freease Web siap di http://localhost:${PORT}${PASSWORD ? ' (dengan kata sandi)' : ''}`));
