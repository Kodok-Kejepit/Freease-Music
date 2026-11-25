// Mengambil URL audio YouTube lalu meneruskannya (proxy) ke browser. URL googlevideo terkunci ke IP
// yang memintanya, jadi browser tidak bisa memakainya langsung — server yang mengunduh & meneruskan.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import { yt } from './youtube.js';

const cache = new Map(); // id → { audio: Format[], video: Format[], expires }
const failures = new Map(); // id → waktu gagal terakhir (jangan dicoba ulang terus-menerus)
let ytdlpOk = null;
let lastEngine = null; // 'yt-dlp' | 'youtubei' — mesin yang terakhir berhasil

// VPS kecil (1 GB): batasi proses yt-dlp yang berjalan bersamaan (masing-masing ±100 MB RAM).
const MAX_JOBS = Math.max(1, Number(process.env.YTDLP_CONCURRENCY || 2));
let running = 0;
const waiting = [];
async function withSlot(fn) {
  if (running >= MAX_JOBS) await new Promise((r) => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}
/** Permintaan untuk lagu yang sama sedang diproses → tunggu hasil yang sama, jangan jalankan ulang. */
const inflight = new Map();

const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
const COOKIES = process.env.YT_COOKIES_FILE || '';
const POT_URL = process.env.POT_PROVIDER_URL || ''; // mis. http://bgutil:4416

/** Hanya untuk pengujian: ganti cara mengambil URL. */
export function _setResolverForTest(fn) {
  testResolver = fn;
  cache.clear();
}
let testResolver = null;

/** Status mesin pengambil audio, untuk halaman Pengaturan/diagnosa. */
export function streamStatus() {
  return {
    ytdlp: ytdlpOk,
    cookies: !!(COOKIES && existsSync(COOKIES)),
    potProvider: !!POT_URL,
    engine: lastEngine,
    cached: cache.size,
    jobs: running,
    memoryMb: Math.round(process.memoryUsage().rss / 1048576),
  };
}

function runYtdlp(id) {
  return new Promise((resolve, reject) => {
    const args = [
      '-f', 'bestaudio[acodec=opus]/bestaudio[ext=m4a]/bestaudio',
      '--no-playlist', '--no-warnings', '-j', '--skip-download',
      '--js-runtimes', 'node',
    ];
    if (COOKIES && existsSync(COOKIES)) args.push('--cookies', COOKIES);
    if (POT_URL) args.push('--extractor-args', `youtubepot-bgutilhttp:base_url=${POT_URL}`);
    args.push(`https://www.youtube.com/watch?v=${id}`);
    const p = spawn(YTDLP, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), 45_000);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => { clearTimeout(timer); ytdlpOk = false; reject(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(err.trim().split('\n').pop() || `yt-dlp keluar dengan kode ${code}`));
      try {
        const j = JSON.parse(out);
        const r = { ...formatsFromYtdlp(j), meta: metaFromYtdlp(j) };
        if (!r.audio.length) throw new Error('yt-dlp tidak memberi URL audio');
        ytdlpOk = true;
        resolve(r);
      } catch (e) {
        reject(e);
      }
    });
  });
}

const codecOf = (v) => (/^avc1/.test(v) ? 'avc1' : /^(vp9|vp09)/.test(v) ? 'vp9' : /^av01/.test(v) ? 'av01' : null);

/** Format yt-dlp → daftar audio (terbaik dulu) & video tanpa suara (https langsung, bukan HLS). */
export function formatsFromYtdlp(j) {
  const audio = [], video = [];
  for (const f of j.formats || []) {
    if (!f.url || f.protocol !== 'https') continue;
    const headers = f.http_headers || {};
    const hasA = f.acodec && f.acodec !== 'none', hasV = f.vcodec && f.vcodec !== 'none';
    if (hasA && !hasV) {
      audio.push({ url: f.url, headers, mime: f.ext === 'm4a' ? 'audio/mp4' : 'audio/webm', abr: f.abr || f.tbr || 0, opus: f.acodec === 'opus' });
    } else if (hasV && !hasA && f.height) {
      const codec = codecOf(f.vcodec);
      if (codec) video.push({ url: f.url, headers, mime: f.ext === 'webm' ? 'video/webm' : 'video/mp4', height: f.height, fps: f.fps || 30, codec, tbr: f.tbr || 0 });
    }
  }
  // Terbaik dulu. Opus ±25% lebih efisien dari AAC, jadi pada bitrate mirip opus yang menang.
  const q = (a) => a.abr * (a.opus ? 1.25 : 1);
  audio.sort((a, b) => q(b) - q(a));
  return slim({ audio, video });
}

const LANG_NAMES = { id: 'Indonesia', en: 'Inggris', ja: 'Jepang', ko: 'Korea', zh: 'Mandarin', ar: 'Arab', ms: 'Melayu', es: 'Spanyol', fr: 'Prancis', de: 'Jerman', pt: 'Portugis', hi: 'Hindi', th: 'Thai', vi: 'Vietnam', ru: 'Rusia', it: 'Italia', tr: 'Turki', jv: 'Jawa', su: 'Sunda' };
const langName = (code, fallback) => LANG_NAMES[String(code).split('-')[0]] || fallback || code;

/**
 * Info video dari keluaran yt-dlp yang sama (tanpa panggilan tambahan): deskripsi, suka, subscriber,
 * tanggal, bab, dan subtitle. Hanya subtitle asli + subtitle otomatis bahasa asli yang disimpan (bukan
 * 150-an terjemahan otomatis — terjemahan dibuat saat diminta dengan tlang).
 */
export function metaFromYtdlp(j) {
  const json3 = (list) => (list || []).find((f) => f.ext === 'json3')?.url;
  const captions = [];
  for (const [lang, list] of Object.entries(j.subtitles || {})) {
    if (lang === 'live_chat') continue;
    const url = json3(list);
    if (url) captions.push({ lang, name: list[0]?.name || langName(lang), kind: 'manual', url });
  }
  for (const [lang, list] of Object.entries(j.automatic_captions || {})) {
    if (!lang.endsWith('-orig')) continue;
    const url = json3(list);
    if (url) captions.push({ lang: lang.replace(/-orig$/, ''), name: `${langName(lang.replace(/-orig$/, ''))} (otomatis)`, kind: 'asr', url });
  }
  return {
    description: String(j.description || '').slice(0, 5000),
    likes: j.like_count ?? null,
    subscribers: j.channel_follower_count ?? null,
    uploadDate: j.upload_date || null,
    language: j.language || null,
    chapters: (j.chapters || []).map((c) => ({ start: c.start_time, title: c.title })).slice(0, 100),
    captions: captions.slice(0, 20),
  };
}

/** Simpan seperlunya saja di RAM: audio terbaik/hemat/AAC, dan satu video per codec+resolusi. */
function slim({ audio, video }) {
  const keepA = [audio[0], ...audio.filter((a) => a.mime === 'audio/mp4').slice(0, 1), ...audio.filter((a) => a.abr >= 40).slice(-1), audio[audio.length - 1]];
  const best = new Map();
  for (const v of video) {
    const k = `${v.codec}${v.height}`;
    const cur = best.get(k);
    if (!cur || v.fps > cur.fps || (v.fps === cur.fps && v.tbr > cur.tbr)) best.set(k, v);
  }
  return { audio: [...new Set(keepA.filter(Boolean))], video: [...best.values()] };
}

/** Audio: 'high' = terbaik, 'low' = hemat data (±50 kbps). `m4a` = browser tidak bisa opus (iPhone lama). */
export function pickAudio(entry, quality = 'high', m4a = false) {
  const aac = m4a ? entry.audio.filter((a) => a.mime === 'audio/mp4') : [];
  const list = aac.length ? aac : entry.audio;
  if (quality !== 'low') return list[0];
  return [...list].reverse().find((a) => a.abr >= 40) || list[list.length - 1];
}

/**
 * Video tanpa suara setinggi-tingginya ≤ maxHeight. `codecs` = urutan codec yang didukung browser
 * (mis. ['vp9','avc1']); VP9/AV1 setengah ukuran H.264 untuk kualitas sama → hemat bandwidth server.
 */
export function pickVideo(entry, maxHeight = 720, codecs = ['avc1']) {
  const ok = entry.video.filter((v) => codecs.includes(v.codec));
  if (!ok.length) return null;
  const fit = ok.filter((v) => v.height <= maxHeight);
  const pool = fit.length ? fit : [ok.reduce((a, b) => (a.height <= b.height ? a : b))];
  const top = Math.max(...pool.map((v) => v.height));
  return pool.filter((v) => v.height === top).sort((a, b) => (codecs.indexOf(a.codec) - codecs.indexOf(b.codec)) || (b.fps - a.fps))[0];
}

async function viaYoutubei(id) {
  const y = await yt();
  let last;
  for (const client of ['IOS', 'ANDROID', 'TV', 'MWEB', 'WEB']) {
    try {
      const info = await y.getBasicInfo(id, { client });
      const f = info.chooseFormat({ type: 'audio', quality: 'best' });
      const url = await f.decipher(y.session.player);
      const audio = [{ url, mime: f.mime_type?.split(';')[0] || 'audio/webm', headers: {}, abr: (f.bitrate || 0) / 1000, opus: /opus/.test(f.mime_type || '') }];
      const video = [];
      for (const v of info.streaming_data?.adaptive_formats || []) {
        const codec = codecOf(/codecs="([^"]+)"/.exec(v.mime_type || '')?.[1] || '');
        if (!v.has_video || v.has_audio || !codec || !v.height) continue;
        try {
          video.push({ url: await v.decipher(y.session.player), headers: {}, mime: v.mime_type.split(';')[0], height: v.height, fps: v.fps || 30, codec, tbr: (v.bitrate || 0) / 1000 });
        } catch { /* lewati */ }
      }
      const captions = (info.captions?.caption_tracks || []).filter((t) => t.base_url?.startsWith('http')).map((t) => ({
        lang: t.language_code, name: String(t.name?.text || t.name || t.language_code), kind: t.kind === 'asr' ? 'asr' : 'manual', url: t.base_url,
      }));
      const b = info.basic_info || {};
      const meta = { description: String(b.short_description || '').slice(0, 5000), likes: b.like_count ?? null, subscribers: null, uploadDate: null, language: null, chapters: [], captions };
      return { audio, video, meta };
    } catch (e) {
      last = e;
    }
  }
  throw last || new Error('Stream tidak tersedia');
}

/** URL audio terbaik untuk [id] (di-cache ±4 jam; URL YouTube berlaku ±6 jam). */
export async function resolve(id, fresh = false) {
  const c = cache.get(id);
  if (!fresh && c && c.expires > Date.now()) return c;
  if (!fresh && inflight.has(id)) return inflight.get(id);
  const p = resolveNow(id).finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

async function resolveNow(id) {
  const errors = [];
  const engines = testResolver ? [['test', testResolver]] : [['yt-dlp', (x) => withSlot(() => runYtdlp(x))], ['youtubei', viaYoutubei]];
  for (const [name, fn] of engines) {
    try {
      let r = await fn(id);
      if (r.url) r = { audio: [{ abr: 0, ...r }], video: [] }; // bentuk lama (pengujian)
      lastEngine = name;
      const entry = { ...r, expires: Date.now() + 4 * 3600_000 };
      cache.delete(id);
      cache.set(id, entry);
      // RAM VPS kecil: maksimal 300 lagu terakhir (±3 KB per lagu); yang kedaluwarsa dibuang.
      if (cache.size > 300) {
        const now = Date.now();
        for (const [k, v] of cache) if (v.expires < now) cache.delete(k);
        while (cache.size > 300) cache.delete(cache.keys().next().value);
      }
      failures.delete(id);
      return entry;
    } catch (e) {
      errors.push(e.message);
    }
  }
  failures.set(id, Date.now());
  if (failures.size > 500) failures.delete(failures.keys().next().value);
  const err = new Error(errors.join(' | '));
  err.blocked = errors.some((m) => /not a bot|Sign in|confirm|Streaming data not available|LOGIN_REQUIRED|unavailable/i.test(m));
  throw err;
}

const PASS_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'];

/**
 * Teruskan audio/video [id] ke [res], mendukung Range (seek) dan mencoba ulang sekali bila URL kedaluwarsa.
 * `want` = { kind: 'audio', quality } atau { kind: 'video', height, codecs }.
 */
export async function proxy(id, req, res, want = { kind: 'audio' }) {
  let attempt = 0;
  while (attempt < 2) {
    const all = await resolve(id, attempt > 0);
    const entry = want.kind === 'video' ? pickVideo(all, want.height, want.codecs) : pickAudio(all, want.quality, want.m4a);
    if (!entry) return res.status(404).json({ error: 'Video tidak tersedia untuk lagu ini' });
    const headers = { ...entry.headers };
    if (req.headers.range) headers.Range = req.headers.range;
    const ac = new AbortController();
    req.on('close', () => ac.abort());
    let up;
    try {
      up = await fetch(entry.url, { headers, signal: ac.signal });
    } catch (e) {
      if (ac.signal.aborted) return;
      throw e;
    }
    if ((up.status === 403 || up.status === 410) && attempt === 0) {
      cache.delete(id);
      attempt++;
      continue;
    }
    res.status(up.status);
    for (const h of PASS_HEADERS) {
      const v = up.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    if (!up.headers.get('content-type') || up.headers.get('content-type') === 'application/octet-stream') res.setHeader('content-type', entry.mime);
    res.setHeader('cache-control', 'private, max-age=3600');
    if (!up.body) return res.end();
    Readable.fromWeb(up.body).on('error', () => res.destroy()).pipe(res);
    return;
  }
}

/**
 * Diagnosa untuk uji coba VPS: ambil sedikit audio dari 3 video musik populer. Lolos kalau minimal 2
 * berhasil (satu video kadang lolos sendiri padahal lagu lain diblokir, jadi satu saja tidak cukup).
 */
const DIAG_IDS = ['kJQP7kiw5Fk', 'QqJ-Vp8mvbk', '_N6vSc_mT6I'];

async function tryOne(id) {
  try {
    const e = pickAudio(await resolve(id, true));
    const r = await fetch(e.url, { headers: { ...e.headers, Range: 'bytes=0-65535' } });
    await r.arrayBuffer().catch(() => null);
    return { ok: r.status === 206 || r.status === 200, blocked: false, engine: lastEngine, error: r.ok ? null : `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, blocked: !!e.blocked, engine: null, error: e.message };
  }
}

export async function diagnose(ids = DIAG_IDS) {
  const t0 = Date.now();
  const results = [];
  for (const id of ids) results.push(await tryOne(id));
  const passed = results.filter((r) => r.ok).length;
  const ok = passed >= Math.min(2, ids.length);
  const engine = results.find((r) => r.ok)?.engine ?? null;
  const blocked = results.some((r) => r.blocked);
  return {
    ok, engine, passed, total: ids.length, blocked, ms: Date.now() - t0,
    message: ok
      ? `Server bisa mengambil audio YouTube (${passed}/${ids.length} lagu uji berhasil)`
      : blocked
        ? `IP server diblokir YouTube (${passed}/${ids.length} lagu uji berhasil) — coba PO Token/cookies atau server rumah`
        : `Gagal mengambil audio (${passed}/${ids.length}): ${results.find((r) => !r.ok)?.error ?? ''}`,
  };
}
