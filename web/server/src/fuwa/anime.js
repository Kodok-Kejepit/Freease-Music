// Anime Freease Stream dari Animekompi (API JSON, subtitle Indonesia). Server video embed dibuka di sini menjadi
// berkas video langsung, karena Freease tidak memakai iframe (tanpa iklan): PixelDrain, Blogger, OK.ru, MP4Upload.
import { fetchJson, fetchText, decodeEntities, SourceError, ttlCache, quiet, sameTitle, UA_DESKTOP, UA_MOBILE } from './net.js';
import { mediaUrl } from './media.js';
import * as OD from './otakudesu.js';
import * as AC from './anichin.js';
import { embedSource, sortSources } from './embed.js';
import { resolveHls } from './hosts.js';

/** Sumber anime yang tersedia (ID tanpa awalan = Animekompi). */
export const SOURCES = [{ key: 'ak', name: 'Animekompi' }, { key: 'od', name: OD.NAME }, { key: 'ac', name: AC.NAME, donghua: true }];

const BASE = 'https://v11.animekompi.sbs';
const cache = ttlCache(400);
const api = (path, ttl = 5 * 60_000) => cache(path, ttl, () => fetchJson(BASE + path, { headers: { referer: BASE + '/' } }));

const abs = (u) => {
  const s = String(u ?? '').trim();
  if (!s || s === 'null') return null;
  if (/^https?:\/\//.test(s)) return s;
  return BASE + (s.startsWith('/') ? s : '/' + s);
};
const status = (s) => ({ ongoing: 'Ongoing', completed: 'Tamat' }[String(s ?? '').toLowerCase()] ?? (s || null));
const num = (n) => (n == null || n === '' ? '' : String(Number.isFinite(Number(n)) ? Number(n) : n).trim());

/** Bentuk kartu anime yang sama untuk semua daftar. */
export function card(o) {
  return {
    id: String(o.slug ?? o.animeSlug ?? ''),
    title: String(o.title ?? o.animeTitle ?? o.slug ?? ''),
    cover: abs(o.cover),
    banner: abs(o.banner),
    synopsis: o.synopsis ?? null,
    type: o.type ?? o.animeType ?? null,
    status: status(o.status ?? o.animeStatus),
    year: o.year || null,
    rating: o.rating || null,
    studio: o.studio || null,
    views: o.views ?? null,
    genres: Array.isArray(o.genres) ? o.genres.map((g) => (typeof g === 'string' ? g : g?.name)).filter(Boolean) : [],
    source: 'Animekompi',
  };
}
const cards = (list) => {
  const seen = new Set();
  return (list ?? []).map(card).filter((c) => c.id && !seen.has(c.id) && seen.add(c.id));
};

export async function home() {
  const [h, od, odDone] = await Promise.all([
    api('/api/home', 3 * 60_000),
    quiet(OD.list('ongoing', 1), 12000, { items: [] }),
    quiet(OD.list('completed', 1), 12000, { items: [] }),
  ]);
  return {
    od: {
      latest: od.items.map((a) => ({ ...a, episodeId: null, at: null })),
      completed: odDone.items,
    },
    featured: cards(h.featured),
    latest: (h.latestEpisodes ?? []).map((e) => ({
      ...card(e), episode: num(e.episodeNumber), episodeId: e.slug, at: e.createdAt ?? null,
    })),
    trending: cards(h.trendingToday),
    weekly: cards(h.popularWeekly),
    monthly: cards(h.popularMonthly),
    allTime: cards(h.popularAllTime),
    ongoing: cards(h.ongoing),
    completed: cards(h.completed),
    movies: cards(h.movies),
  };
}

const ORDERS = new Set(['popular', 'latest', 'title', 'rating', 'updated']);
export async function browse({ order = 'popular', page = 1, genre, type, status: st, source } = {}) {
  if (source === 'ac') return { ...(await AC.list({ order, page, status: st, genre })), total: null };
  if (source === 'od') {
    const r = genre ? await OD.byGenre(genre, page) : await OD.list(st === 'completed' ? 'completed' : 'ongoing', page);
    return { ...r, total: null };
  }
  const p = new URLSearchParams({ order: ORDERS.has(order) ? order : 'popular', page: String(Math.max(1, Math.min(500, page | 0 || 1))) });
  if (genre) p.set('genre', String(genre).slice(0, 40));
  if (type) p.set('type', String(type).toLowerCase().slice(0, 20));
  if (st) p.set('status', String(st).toLowerCase().slice(0, 20));
  const j = await api('/api/anime?' + p);
  return { items: cards(j.data), page: j.page ?? Number(p.get('page')), totalPages: j.totalPages ?? 1, total: j.total ?? null };
}

/** Beranda Donghua: rilisan terbaru & rekomendasi Anichin, plus donghua di Animekompi. */
export async function donghuaHome() {
  const [ac, ak] = await Promise.all([AC.home(), quiet(browse({ genre: 'donghua', order: 'latest' }), 10000, { items: [] })]);
  return { ...ac, animekompi: ak.items };
}

export async function latestEpisodes(page = 1) {
  const j = await api(`/api/episodes?page=${Math.max(1, page | 0 || 1)}`).catch(() => null);
  if (j?.data) return { items: j.data.map((e) => ({ ...card({ ...e, slug: e.animeSlug }), episode: num(e.episodeNumber ?? e.number), episodeId: e.slug, at: e.createdAt ?? null })), totalPages: j.totalPages ?? 1 };
  const h = await home();
  return { items: h.latest, totalPages: 1 };
}

async function searchAk(s) {
  const j = await api('/api/search?q=' + encodeURIComponent(s), 10 * 60_000);
  return cards(j.anime);
}
/** Cari di semua sumber, hasil diselang-seling supaya tiap sumber kebagian tempat di atas. */
export async function search(q) {
  const s = String(q ?? '').trim().slice(0, 100);
  if (!s) return [];
  const lists = await Promise.all([quiet(searchAk(s), 10000, []), quiet(OD.search(s), 10000, []), quiet(AC.search(s), 10000, [])]);
  const out = [];
  for (let i = 0; i < Math.max(...lists.map((l) => l.length)); i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
}

/** Judul yang sama di sumber lain (untuk pindah sumber kalau server video di satu sumber kosong). */
export async function alternatives(id, title, alts = []) {
  const clean = String(title ?? '').trim().slice(0, 120);
  if (!clean) return [];
  const words = clean.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 4).join(' ');
  const [a, b, c] = await Promise.all([quiet(searchAk(words), 10000, []), quiet(OD.search(words), 10000, []), quiet(AC.search(words), 10000, [])]);
  return [...a, ...b, ...c].filter((x) => x.id !== id && (sameTitle(clean, x.title) || alts.some((t) => sameTitle(t, x.title)))).slice(0, 6);
}

export async function genres(source) {
  if (source === 'od') return OD.genres();
  if (source === 'ac') return AC.genres();
  const j = await api('/api/genres', 6 * 3600_000);
  return (Array.isArray(j) ? j : []).filter((g) => g.slug && g.name && (g.count ?? 1) > 0).map((g) => ({ id: g.slug, name: g.name, count: g.count ?? null }));
}

const DAYS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
export async function schedule(kind) {
  if (kind === 'donghua') return AC.schedule();
  const [j, od] = await Promise.all([api('/api/schedule', 15 * 60_000), quiet(OD.schedule(), 12000, [])]);
  return DAYS.map((day) => {
    const d = (j.days ?? []).find((x) => String(x.day).toLowerCase() === day.toLowerCase());
    const items = (d?.items ?? []).filter((it) => it.animeSlug).map((it) => ({
      id: it.animeSlug, title: it.title || it.animeSlug, cover: abs(it.cover), episode: num(it.episode), time: it.time ?? null, source: 'Animekompi',
    }));
    // Judul yang juga ada di Animekompi tidak diulang; sisanya dari Otakudesu.
    const extra = (od.find((x) => x.day === day)?.items ?? []).filter((o) => !items.some((it) => sameTitle(it.title, o.title)));
    return { day, items: [...items, ...extra.map((o) => ({ ...o, source: OD.NAME }))] };
  });
}

const SLUG = /^[a-z0-9][a-z0-9._-]{0,200}$/i;
export function checkSlug(s) {
  if (!SLUG.test(String(s ?? ''))) throw new SourceError('ID tidak valid', 400);
  return String(s);
}

export async function detail(slug) {
  if (OD.own(slug)) return OD.detail(slug);
  if (AC.own(slug)) return AC.detail(slug);
  const j = await api('/api/anime/' + encodeURIComponent(checkSlug(slug)));
  if (!j?.anime) throw new SourceError('Anime tidak ditemukan', 404);
  const a = card({ ...j.anime, genres: j.genres });
  const eps = (j.episodes ?? []).filter((e) => e.slug).map((e) => ({
    id: e.slug, number: num(e.number ?? e.numberLabel), title: e.title || `Episode ${num(e.number)}`, at: e.releasedAt ?? e.createdAt ?? null, views: e.views ?? null,
  }));
  eps.sort((x, y) => (Number(y.number) || 0) - (Number(x.number) || 0));
  return {
    ...a,
    altTitles: j.anime.altTitles || null,
    episodes: eps,
    batch: (j.batchDownloads ?? []).map((b) => ({ label: b.label ?? b.resolution ?? 'Batch', url: b.url, resolution: b.resolution ?? null })).filter((b) => /^https?:/.test(b.url || '')),
  };
}

// ---------------------------------------------------------------- server video

/** Satu server embed → daftar berkas video yang bisa diputar <video> (kosong = tidak bisa dibuka). */
async function resolveSource(src) {
  const url = String(src.url ?? '').trim();
  const label = String(src.label ?? 'Server').replace(/\s*\[[^\]]*\]\s*/g, ' ').trim() || 'Server';
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  if (/pixeldrain\.com$/.test(host)) {
    const id = url.match(/pixeldrain\.com\/(?:u|api\/file|l)\/([A-Za-z0-9]+)/)?.[1];
    if (!id || /\/l\//.test(url)) return [];
    return [{ label, quality: qualityOf(src.quality, label, url), type: 'mp4', url: `https://pixeldrain.com/api/file/${id}`, fallback: mediaUrl(`https://pixeldrain.com/api/file/${id}`) }];
  }
  if (host === 'www.blogger.com' && url.includes('video.g')) return blogger(url, label);
  if (host === 'ok.ru' || host === 'm.ok.ru') return okru(url, label);
  if (/mp4upload\.com$/.test(host)) return mp4upload(url, label);
  if (src.kind === 'direct' && /\.(mp4|webm)(\?|$)/i.test(url)) return [{ label, quality: qualityOf(src.quality, label, url), type: 'mp4', url: mediaUrl(url) }];
  const q = qualityOf(src.quality, label, url);
  // Pemutar berisi iklan (VidHide, Streamruby, Mecdn, Vidara, Dailymotion, …): daftar putarnya dibuka jadi HLS.
  const hls = await resolveHls(url, label, q).catch(() => []);
  return hls.length ? hls : embedSource(url, q);
}

const ITAG = { 17: 144, 18: 360, 22: 720, 34: 360, 35: 480, 36: 240, 37: 1080, 43: 360, 59: 480, 78: 480 };
async function blogger(url, label) {
  const { text } = await fetchText(url, { ua: UA_DESKTOP, timeout: 12000 });
  const html = decodeEntities(text).replace(/\\u0026/g, '&').replace(/\\u003d/g, '=').replace(/\\\//g, '/');
  const start = html.indexOf('streamingData');
  if (start < 0) return [];
  const end = html.indexOf('serverAbrStreamingUrl', start);
  const seg = html.slice(start, end > 0 ? end : undefined);
  const out = new Map();
  for (const m of seg.matchAll(/https:\/\/[a-z0-9.-]+googlevideo\.com\/videoplayback\?[^"\\\s]+/g)) {
    const itag = Number(m[0].match(/[?&]itag=(\d+)/)?.[1]);
    const h = ITAG[itag];
    if (!out.has(h ?? m[0])) out.set(h ?? m[0], { label, quality: h ? `${h}p` : 'Auto', type: 'mp4', url: mediaUrl(m[0]) });
  }
  return [...out.values()];
}

const OK_NAMES = { full: 1080, hd: 720, sd: 480, low: 360, lowest: 240, mobile: 144 };
async function okru(url, label) {
  const id = url.match(/(?:videoembed|video)\/(\d+)/)?.[1];
  if (!id) return [];
  // OK.ru kadang menolak sesaat saat banyak permintaan beruntun: coba sekali lagi sebelum dianggap kosong.
  let raw;
  for (let i = 0; i < 2 && !raw; i++) {
    if (i) await new Promise((r) => setTimeout(r, 1500));
    const { text } = await fetchText(`https://ok.ru/videoembed/${id}`, { ua: UA_DESKTOP, timeout: 12000 });
    raw = text.match(/data-options="([^"]+)"/)?.[1];
    if (/vp_video_stub_txt/.test(text)) break;
  }
  if (!raw) return [];
  let md;
  try {
    const o = JSON.parse(decodeEntities(raw));
    md = typeof o.flashvars?.metadata === 'string' ? JSON.parse(o.flashvars.metadata) : o.flashvars?.metadata;
  } catch { return []; }
  const vids = (md?.videos ?? []).filter((v) => v.url && OK_NAMES[v.name] && OK_NAMES[v.name] >= 360);
  return vids.map((v) => ({ label, quality: `${OK_NAMES[v.name]}p`, type: 'mp4', url: mediaUrl(v.url, 'https://ok.ru/') }));
}

async function mp4upload(url, label) {
  const id = url.match(/mp4upload\.com\/(?:embed-)?([a-z0-9]{8,16})/i)?.[1];
  if (!id) return [];
  const { text } = await fetchText(`https://www.mp4upload.com/embed-${id}.html`, { ua: UA_MOBILE, timeout: 12000, headers: { referer: 'https://www.mp4upload.com/' } });
  const src = text.match(/src:\s*"(https:\/\/[^"]+\.mp4)"/)?.[1];
  return src ? [{ label, quality: qualityOf('', label, src), type: 'mp4', url: mediaUrl(src, 'https://www.mp4upload.com/') }] : [];
}

function qualityOf(q, label, url) {
  const m = String(q ?? '').match(/(\d{3,4})/) ?? String(label).match(/(\d{3,4})\s*p/i) ?? String(url).match(/(\d{3,4})p/i);
  return m ? `${m[1]}p` : 'Auto';
}

const streamCache = ttlCache(200);
export async function episode(epSlug) {
  if (OD.own(epSlug)) return OD.episode(epSlug, blogger);
  if (AC.own(epSlug)) return AC.episode(epSlug, (src) => resolveSource(src).catch(() => resolveSource(src)));
  const slug = checkSlug(epSlug);
  const j = await api('/api/episodes/' + encodeURIComponent(slug), 10 * 60_000);
  const ep = j?.episode;
  if (!ep) throw new SourceError('Episode tidak ditemukan', 404);
  // Tautan video bertanda tangan & terikat IP server: disimpan sebentar saja (±40 menit). Hasil kosong tidak
  // disimpan (bisa cuma gangguan sesaat), dan tiap server dicoba sekali lagi sebelum dianggap gagal.
  let sources = [];
  try {
    sources = await streamCache('ep:' + slug, 40 * 60_000, async () => {
      const all = await Promise.all((j.sources ?? []).map((s) => resolveSource(s).catch(() => resolveSource(s)).catch(() => [])));
      const seen = new Set();
      const out = sortSources(all.flat().filter((s) => !seen.has(s.url) && seen.add(s.url)));
      if (!out.length) throw new Error('kosong');
      return out;
    });
  } catch { sources = []; }
  const list = (j.episodeList ?? []).filter((e) => e.slug).map((e) => ({ id: e.slug, number: num(e.number ?? e.numberLabel), title: e.title || `Episode ${num(e.number)}` }));
  return {
    id: slug,
    number: num(ep.number ?? ep.numberLabel),
    title: ep.title || `Episode ${num(ep.number)}`,
    anime: j.anime ? card({ ...j.anime, genres: j.genres }) : null,
    prev: j.prev?.slug ? { id: j.prev.slug, number: num(j.prev.number) } : null,
    next: j.next?.slug ? { id: j.next.slug, number: num(j.next.number) } : null,
    sources,
    unsupported: (j.sources ?? []).length - new Set(sources.map((s) => s.label)).size,
    downloads: (j.downloads ?? []).filter((d) => /^https?:/.test(d.url || '')).map((d) => ({ label: d.label, resolution: d.resolution ?? null, url: d.url })),
    episodes: list,
  };
}

/**
 * Episode bernomor sama dari judul yang sama di sumber lain, beserta server videonya — dipakai pemutar saat server
 * di sumber sekarang kosong atau semuanya gagal, supaya episode tetap bisa ditonton tanpa pindah halaman.
 */
export async function episodeElsewhere(id, title, alts, number) {
  const n = Number(String(number ?? '').match(/\d+(?:\.\d+)?/)?.[0]);
  if (!Number.isFinite(n)) return [];
  const others = (await alternatives(id, title, alts)).slice(0, 4);
  const found = await Promise.all(others.map(async (a) => {
    const det = await quiet(detail(a.id), 15000, null);
    const ep = det?.episodes?.find((e) => Number(e.number) === n);
    if (!ep) return null;
    const e = await quiet(episode(ep.id), 30000, null);
    if (!e?.sources?.length) return null;
    return { source: a.source ?? 'Sumber lain', animeId: a.id, episodeId: ep.id, sources: e.sources };
  }));
  return found.filter(Boolean);
}
