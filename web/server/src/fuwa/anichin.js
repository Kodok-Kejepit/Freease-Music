// Donghua (animasi China) sub Indonesia dari Anichin. ID diawali `ac:`. Server video dibuka lewat resolver bersama
// di anime.js (OK.ru sampai 1080p, Blogger, dst.); Abyss & MEGA lewat iframe ber-sandbox (embed.js).
import { fetchText, htmlLine, htmlText, SourceError, ttlCache, UA_DESKTOP } from './net.js';
import { imgUrl } from './media.js';
import { sortSources } from './embed.js';

const BASE = (process.env.FS_ANICHIN_URL || 'https://anichin.moe').replace(/\/+$/, '');
export const PREFIX = 'ac:';
export const NAME = 'Anichin';
const cache = ttlCache(300);
const page = (path, ttl = 5 * 60_000) => cache(path, ttl, async () => (await fetchText(BASE + path, { ua: UA_DESKTOP, headers: { referer: BASE + '/' } })).text);

const SLUG = /^[a-z0-9][a-z0-9._-]{0,200}$/i;
const abs = (u) => (!u ? null : u.startsWith('http') ? u : BASE + (u.startsWith('/') ? u : '/' + u));
const img = (u) => imgUrl(abs(u ? htmlLine(u) : null), BASE + '/');
const slugOf = (u) => String(u ?? '').replace(/^https?:\/\/[^/]+/, '').match(/^\/(?:anime\/)?([^/?#"]+)\/?$/)?.[1] ?? null;
// "Season 2 Episode 98 [124]": nomor dalam kurung = nomor total seri, supaya tidak bentrok dengan musim pertama.
const epNum = (t) => { const m = String(t ?? '').match(/Episode\s+(\d+(?:\.\d+)?)(?:\s*\[(\d+(?:\.\d+)?)\])?/i); return m?.[2] ?? m?.[1] ?? ''; };
const numText = (t) => { const s = htmlLine(t); return s.match(/\[(\d+(?:\.\d+)?)\]/)?.[1] ?? s.match(/^\d+(?:\.\d+)?/)?.[0] ?? s; };
const stripEp = (t) => htmlLine(t).replace(/\s+Episode\s+\d+(?:\.\d+)?.*$/i, '').replace(/\s+Subtitle Indonesia$/i, '').trim();
const status = (s) => (/ongoing/i.test(s ?? '') ? 'Ongoing' : /complete|tamat/i.test(s ?? '') ? 'Tamat' : /hiatus/i.test(s ?? '') ? 'Hiatus' : null);

export function own(id) { return String(id ?? '').startsWith(PREFIX); }
function check(id) {
  const s = String(id ?? '').slice(PREFIX.length);
  if (!own(id) || !SLUG.test(s)) throw new SourceError('ID tidak valid', 400);
  return s;
}

const base = (o) => ({
  id: PREFIX + o.slug, title: o.title, cover: o.cover ?? null, banner: null, synopsis: o.synopsis ?? null, type: o.type ?? 'Donghua',
  status: o.status ?? null, year: o.year ?? null, rating: o.rating ?? null, studio: o.studio ?? null, views: null, genres: o.genres ?? [], source: NAME,
});

/** Kartu `.bsx`: seri (status) atau episode terbaru (Ep N). */
function cards(html) {
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/<div class="bsx">\s*<a href="([^"]+)"[^>]*title="([^"]*)"([\s\S]*?)<\/a>/g)) {
    const slug = slugOf(m[1]);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const b = m[3];
    const epx = htmlLine(b.match(/class=['"]epx[^'"]*['"][^>]*>([^<]*)/)?.[1]);
    const isEp = /-episode-\d/.test(slug);
    const ep = epNum(m[2]) || epx.match(/^Ep\s*(\d+(?:\.\d+)?)/i)?.[1] || '';
    out.push({
      ...base({ slug, title: isEp ? stripEp(m[2]) : htmlLine(m[2]), cover: img(b.match(/<img[^>]+src="([^"]+)"/)?.[1]), type: htmlLine(b.match(/class="typez[^"]*">([^<]*)/)?.[1]) || 'Donghua', status: status(epx) }),
      episode: ep, episodeId: isEp ? PREFIX + slug : null, time: epx.match(/(\d{1,2}:\d{2})/)?.[1] ?? null,
      latestEp: htmlLine(b.match(/class="sb [^"]*">([^<]*)/)?.[1]).match(/^\d+(?:\.\d+)?$/)?.[0] ?? null,
    });
  }
  return out;
}

const ORDERS = { popular: 'popular', latest: 'update', rating: 'rating', title: 'title' };
export async function list({ order = 'latest', page: p = 1, status: st, genre } = {}) {
  const n = Math.max(1, Math.min(300, p | 0 || 1));
  const q = new URLSearchParams({ page: String(n), status: st === 'completed' ? 'completed' : st === 'ongoing' ? 'ongoing' : '', type: '', order: ORDERS[order] ?? 'update' });
  if (genre) q.append('genre[]', String(genre).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40));
  const html = await page(`/anime/?${q}`, 5 * 60_000);
  const items = cards(html).map(({ episodeId, time, ...c }) => c);
  return { items, page: n, totalPages: /class="r"[^>]*>\s*Selanjutnya|rel="next"/.test(html) ? n + 1 : n };
}

export async function home() {
  const html = await page('/', 3 * 60_000);
  const seg = (title) => {
    const i = html.indexOf(`<h3>${title}</h3>`);
    if (i < 0) return '';
    const j = html.indexOf('class="releases"', i + 20);
    return html.slice(i, j > 0 ? j : i + 60000);
  };
  const [popular, ongoing, completed] = await Promise.all([
    list({ order: 'popular' }).catch(() => ({ items: [] })),
    list({ order: 'latest', status: 'ongoing' }).catch(() => ({ items: [] })),
    list({ order: 'latest', status: 'completed' }).catch(() => ({ items: [] })),
  ]);
  return {
    latest: cards(seg('Rilisan Terbaru')).filter((c) => c.episodeId),
    recommended: cards(seg('Rekomendasi')).map(({ episodeId, time, ...c }) => c),
    popular: popular.items, ongoing: ongoing.items, completed: completed.items,
  };
}

export async function search(q) {
  const s = String(q ?? '').trim().slice(0, 100);
  if (!s) return [];
  return cards(await page(`/?s=${encodeURIComponent(s)}`, 10 * 60_000)).map(({ episodeId, time, ...c }) => c);
}

export async function genres() {
  const html = await page('/anime/', 24 * 3600_000);
  const seen = new Set();
  return [...html.matchAll(/name="genre\[\]"[^>]*value="([^"]+)"[^>]*>\s*<label[^>]*>([^<]+)</g)]
    .map((m) => ({ id: m[1], name: htmlLine(m[2]), count: null })).filter((g) => g.name.length >= 3 && !seen.has(g.id) && seen.add(g.id));
}

const DAYS = { sch_monday: 'Senin', sch_tuesday: 'Selasa', sch_wednesday: 'Rabu', sch_thursday: 'Kamis', sch_friday: 'Jumat', sch_saturday: 'Sabtu', sch_sunday: 'Minggu' };
export async function schedule() {
  const html = await page('/schedule/', 30 * 60_000);
  const out = Object.values(DAYS).map((day) => ({ day, items: [] }));
  for (const m of html.matchAll(/class="bixbox schedulepage (sch_[a-z]+)"([\s\S]*?)(?=class="bixbox schedulepage|<div id="sidebar"|$)/g)) {
    const day = out.find((d) => d.day === DAYS[m[1]]);
    if (!day) continue;
    for (const c of cards(m[2])) {
      day.items.push({ id: c.id, title: c.title, cover: c.cover, episode: c.latestEp ?? '', time: c.time ? `2026-01-01T${c.time.padStart(5, '0')}:00+07:00` : null, source: NAME });
    }
  }
  return out;
}

function spe(html, label) {
  return htmlLine(html.match(new RegExp(`<b>${label}:?</b>([\\s\\S]*?)</span>`, 'i'))?.[1]) || null;
}

export async function detail(id) {
  const slug = check(id);
  let html = await page(`/${slug}/`);
  if (!/class="eplister"/.test(html)) html = await page(`/anime/${slug}/`).catch(() => html);
  if (!/class="eplister"/.test(html)) throw new SourceError('Donghua tidak ditemukan', 404);
  const eps = [...(html.match(/class="eplister"[\s\S]*?<\/ul>/)?.[0] ?? '').matchAll(/<a href="([^"]+)">([\s\S]*?)<\/a>/g)].map((m) => {
    const ep = slugOf(m[1]);
    return ep && /-episode-\d/.test(ep) ? {
      id: PREFIX + ep, number: numText(m[2].match(/class="epl-num">([^<]*)/)?.[1]) || epNum(htmlLine(m[2].match(/class="epl-title">([^<]*)/)?.[1])) || epNum(ep.replace(/-/g, ' ')),
      title: htmlLine(m[2].match(/class="epl-title">([^<]*)/)?.[1]) || `Episode ${epNum(ep.replace(/-/g, ' '))}`,
      at: htmlLine(m[2].match(/class="epl-date">([^<]*)/)?.[1]) || null, views: null,
    } : null;
  }).filter(Boolean);
  eps.sort((x, y) => (Number(y.number) || 0) - (Number(x.number) || 0));
  const rating = html.match(/<strong>Rating\s*([\d.]+)/)?.[1] ?? null;
  return {
    ...base({
      slug, title: htmlLine(html.match(/<h1 class="entry-title"[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? slug),
      cover: img(html.match(/class="thumb"[^>]*>\s*<img[^>]+src="([^"]+)"/)?.[1]),
      synopsis: htmlText(html.match(/class="entry-content"[^>]*>([\s\S]*?)<\/div>/)?.[1]) || null,
      type: spe(html, 'Tipe') ?? 'Donghua', status: status(spe(html, 'Status')), rating, studio: spe(html, 'Studio'),
      year: Number(spe(html, 'Tanggal rilis')?.match(/(\d{4})/)?.[1]) || null,
      genres: [...(html.match(/class="genxed">([\s\S]*?)<\/div>/)?.[1] ?? '').matchAll(/>([^<]+)<\/a>/g)].map((x) => htmlLine(x[1])),
    }),
    altTitles: htmlLine(html.match(/<span class="alter">([^<]*)/)?.[1]) || null,
    episodes: eps,
    batch: [],
  };
}

const streamCache = ttlCache(200);
/** [resolve] = resolver server video bersama dari anime.js ({ url, label, quality } → daftar sumber). */
export async function episode(id, resolve) {
  const slug = check(id);
  const html = await page(`/${slug}/`, 10 * 60_000);
  const title = htmlLine(html.match(/<h1 class="entry-title"[^>]*>([\s\S]*?)<\/h1>/)?.[1]);
  if (!title) throw new SourceError('Episode tidak ditemukan', 404);
  const series = slugOf(html.match(/series <a href="([^"]+)"/)?.[1] ?? html.match(/href='([^']+)' aria-label='Semua Episode'/)?.[1]);
  // Tautan sebelum/berikutnya kadang menunjuk pengumuman (hiatus): yang dipakai cuma halaman episode.
  const isEp = (s) => (s && /-episode-\d/.test(s) ? s : null);
  const prev = isEp(slugOf(html.match(/<a[^>]*href="([^"]+)"[^>]*rel="prev"/)?.[1]));
  const next = isEp(slugOf(html.match(/<a[^>]*href="([^"]+)"[^>]*rel="next"/)?.[1]));
  const list = [...(html.match(/class="episodelist">[\s\S]*?<\/ul>/)?.[0] ?? '').matchAll(/<a href="([^"]+)"[\s\S]*?<h3>([\s\S]*?)<\/h3>/g)]
    .map((m) => ({ id: PREFIX + slugOf(m[1]), number: epNum(m[2]), title: htmlLine(m[2]) })).filter((e) => /-episode-\d/.test(e.id));
  const mirrors = [...html.matchAll(/<option[^>]*value="([A-Za-z0-9+/=]{16,})"[^>]*>([^<]*)/g)].map((m) => {
    const decoded = Buffer.from(m[1], 'base64').toString();
    return { label: htmlLine(m[2]), url: decoded.match(/src="([^"]+)"/i)?.[1] };
  }).filter((m) => m.url && /^https:/.test(m.url));

  let sources = [];
  try {
    sources = await streamCache('ep:' + slug, 40 * 60_000, async () => {
      const all = await Promise.all(mirrors.map((m) => resolve({ url: m.url, label: m.label.replace(/\[[^\]]*\]/g, '').trim() || 'Server', quality: '' }).catch(() => [])));
      const seen = new Set();
      const out = sortSources(all.flat().filter((s) => !seen.has(s.url) && seen.add(s.url)));
      if (!out.length) throw new Error('kosong');
      return out;
    });
  } catch { sources = []; }

  let anime = null;
  if (series) anime = await detail(PREFIX + series).then(({ episodes, batch, altTitles, ...a }) => a).catch(() => null);
  const num = (s) => list.find((e) => e.id === PREFIX + s)?.number || epNum(String(s).replace(/-/g, ' '));
  return {
    id: PREFIX + slug,
    number: epNum(title) || html.match(/itemprop="episodeNumber" content="([^"]+)"/)?.[1] || '',
    title: title.replace(/\s*Subtitle Indonesia\s*$/i, ''),
    anime,
    prev: prev ? { id: PREFIX + prev, number: num(prev) } : null,
    next: next ? { id: PREFIX + next, number: num(next) } : null,
    sources,
    unsupported: Math.max(0, mirrors.length - new Set(sources.map((s) => s.label)).size),
    downloads: [],
    episodes: list,
  };
}
