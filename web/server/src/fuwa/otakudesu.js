// Sumber anime kedua: Otakudesu (HTML, subtitle Indonesia, rilis sangat cepat). ID diawali `od:` supaya bisa
// hidup berdampingan dengan ID Animekompi. Server videonya dibuka di sini: odcdn (MP4 langsung), Blogger, Filedon.
import { fetchText, decodeEntities, htmlLine, htmlText, SourceError, ttlCache, UA_DESKTOP } from './net.js';
import { mediaUrl } from './media.js';
import { embedSource, sortSources } from './embed.js';

// Domain Otakudesu sering berganti; tautan dibaca tanpa memedulikan host-nya.
const BASE = (process.env.FS_OTAKUDESU_URL || 'https://otakudesu.blog').replace(/\/+$/, '');
export const PREFIX = 'od:';
export const NAME = 'Otakudesu';
const cache = ttlCache(300);
const page = (path, ttl = 5 * 60_000) => cache(path, ttl, async () => (await fetchText(BASE + path, { ua: UA_DESKTOP, headers: { referer: BASE + '/' } })).text);

const SLUG = /^[a-z0-9][a-z0-9._-]{0,200}$/i;
const slugOf = (url, kind) => String(url ?? '').match(new RegExp(`/${kind}/([^/?#"]+)/?`))?.[1] ?? null;
const cleanTitle = (t) => htmlLine(t).replace(/\s*(\(Episode[^)]*\))?\s*(Sub(title)?\s*Indo(nesia)?)\s*$/i, '').replace(/\s+Sub\s*Indo.*$/i, '').trim();
const epNum = (t) => String(t ?? '').match(/Episode\s+(\d+(?:\.\d+)?)/i)?.[1] ?? '';
const status = (s) => (/ongoing/i.test(s ?? '') ? 'Ongoing' : /complete|tamat|selesai/i.test(s ?? '') ? 'Tamat' : s || null);

export function own(id) { return String(id ?? '').startsWith(PREFIX); }
function check(id) {
  const s = String(id ?? '').slice(PREFIX.length);
  if (!own(id) || !SLUG.test(s)) throw new SourceError('ID tidak valid', 400);
  return s;
}

const base = (o) => ({
  id: PREFIX + o.slug, title: o.title, cover: o.cover ?? null, banner: null, synopsis: o.synopsis ?? null, type: o.type ?? null,
  status: o.status ?? null, year: o.year ?? null, rating: o.rating ?? null, studio: o.studio ?? null, views: null, genres: o.genres ?? [], source: NAME,
});

/** Kartu dari daftar ongoing/complete (`.detpost`). */
function detposts(html) {
  const out = [];
  for (const m of html.matchAll(/<div class=['"]detpost['"]>([\s\S]*?)<\/h2>/g)) {
    const b = m[1];
    const slug = slugOf(b.match(/href="([^"]+)"/)?.[1], 'anime');
    if (!slug) continue;
    const ep = htmlLine(b.match(/class=['"]epz['"]>([\s\S]*?)<\/div>/)?.[1]);
    const meta = htmlLine(b.match(/class=['"]epztipe['"]>([\s\S]*?)<\/div>/)?.[1]);
    out.push({
      ...base({ slug, title: cleanTitle(b.match(/class="jdlflm">([\s\S]*)$/)?.[1]), cover: b.match(/<img[^>]+src="([^"]+)"/)?.[1] }),
      episode: ep.match(/(\d+(?:\.\d+)?)/)?.[1] ?? '',
      day: /^\d/.test(meta) ? null : meta || null,
      rating: /^\d+(\.\d+)?$/.test(meta) ? meta : null,
      date: htmlLine(b.match(/class="newnime">([\s\S]*?)<\/div>/)?.[1]) || null,
      status: /Episode\s+\d/i.test(ep) ? 'Ongoing' : 'Tamat',
    });
  }
  return out;
}
const lastPage = (html) => Math.max(1, ...[...html.matchAll(/\/page\/(\d+)\/?"/g)].map((m) => Number(m[1])));

export async function list(kind = 'ongoing', p = 1) {
  const n = Math.max(1, Math.min(300, p | 0 || 1));
  const html = await page(`/${kind === 'completed' ? 'complete-anime' : 'ongoing-anime'}/${n > 1 ? `page/${n}/` : ''}`, 4 * 60_000);
  return { items: detposts(html), page: n, totalPages: lastPage(html) };
}

/** Daftar per genre (`.col-anime`). */
export async function byGenre(genre, p = 1) {
  const g = String(genre ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
  if (!g) throw new SourceError('Genre tidak valid', 400);
  const n = Math.max(1, Math.min(300, p | 0 || 1));
  const html = await page(`/genres/${g}/${n > 1 ? `page/${n}/` : ''}`, 30 * 60_000);
  const items = [];
  for (const m of html.matchAll(/<div class="col-anime">([\s\S]*?)<div class="col-anime-trailer">/g)) {
    const b = m[1];
    const slug = slugOf(b.match(/col-anime-title"><a href="([^"]+)"/)?.[1], 'anime');
    if (!slug) continue;
    items.push(base({
      slug, title: cleanTitle(b.match(/col-anime-title"><a[^>]*>([\s\S]*?)<\/a>/)?.[1]), cover: b.match(/col-anime-cover"><img src="([^"]+)"/)?.[1],
      studio: htmlLine(b.match(/col-anime-studio">([\s\S]*?)<\/div>/)?.[1]) || null, rating: htmlLine(b.match(/col-anime-rating">([\s\S]*?)<\/div>/)?.[1]) || null,
      synopsis: htmlText(b.match(/col-synopsis">([\s\S]*?)<\/div>/)?.[1]).slice(0, 600) || null,
      year: Number(b.match(/col-anime-date">[^<]*?(\d{4})/)?.[1]) || null,
      genres: [...(b.match(/col-anime-genre">([\s\S]*?)<\/div>/)?.[1] ?? '').matchAll(/>([^<]+)<\/a>/g)].map((x) => htmlLine(x[1])),
    }));
  }
  return { items, page: n, totalPages: lastPage(html) };
}

export async function genres() {
  const html = await page('/genre-list/', 24 * 3600_000);
  const seg = html.match(/class="genres">([\s\S]*?)<\/ul>/)?.[1] ?? '';
  return [...seg.matchAll(/href="\/genres\/([^/"]+)\/?"[^>]*>([^<]+)</g)].map((m) => ({ id: m[1], name: htmlLine(m[2]), count: null }));
}

export async function search(q) {
  const s = String(q ?? '').trim().slice(0, 100);
  if (!s) return [];
  const html = await page(`/?s=${encodeURIComponent(s)}&post_type=anime`, 10 * 60_000);
  const out = [];
  for (const m of html.matchAll(/<li style='list-style:none;'>([\s\S]*?)<\/li>/g)) {
    const b = m[1];
    const slug = slugOf(b.match(/<h2><a href="([^"]+)"/)?.[1], 'anime');
    if (!slug) continue;
    out.push(base({
      slug, title: cleanTitle(b.match(/<h2><a[^>]*>([\s\S]*?)<\/a>/)?.[1]), cover: b.match(/<img[^>]+src="([^"]+)"/)?.[1],
      status: status(htmlLine(b.match(/<b>Status<\/b>\s*:\s*([^<]*)/)?.[1])), rating: htmlLine(b.match(/<b>Rating<\/b>\s*:\s*([^<]*)/)?.[1]) || null,
      genres: [...(b.match(/<b>Genres<\/b>([\s\S]*?)<\/div>/)?.[1] ?? '').matchAll(/>([^<]+)<\/a>/g)].map((x) => htmlLine(x[1])),
    }));
  }
  return out;
}

const DAYS = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
export async function schedule() {
  const html = await page('/jadwal-rilis/', 30 * 60_000);
  const out = new Map(DAYS.map((d) => [d, []]));
  for (const m of html.matchAll(/<div class="kglist321"><h2>([^<]+)<\/h2><ul>([\s\S]*?)<\/ul>/g)) {
    const day = DAYS.find((d) => d.toLowerCase() === htmlLine(m[1]).toLowerCase().replace("jum'at", 'jumat'));
    if (!day) continue;
    for (const a of m[2].matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)) {
      const slug = slugOf(a[1], 'anime');
      if (slug) out.get(day).push({ id: PREFIX + slug, title: htmlLine(a[2]), cover: null, episode: '', time: null });
    }
  }
  return DAYS.map((day) => ({ day, items: out.get(day) }));
}

function info(html, label) {
  return htmlLine(html.match(new RegExp(`<b>${label}</b>\\s*:?\\s*([\\s\\S]*?)</span>`, 'i'))?.[1]).replace(/^:\s*/, '');
}

export async function detail(id) {
  const slug = check(id);
  const html = await page(`/anime/${slug}/`);
  if (!/class=['"]fotoanime/.test(html)) throw new SourceError('Anime tidak ditemukan', 404);
  const eps = [];
  const lists = [...html.matchAll(/<div class="episodelist">([\s\S]*?)<\/ul>/g)].map((m) => m[1]);
  const batch = [];
  for (const l of lists) {
    for (const a of l.matchAll(/<li><span><a href="([^"]+)"[^>]*>([^<]+)<\/a><\/span>(?:<span class='zeebr'[^>]*>([^<]*)<\/span>)?/g)) {
      const ep = slugOf(a[1], 'episode');
      if (ep) eps.push({ id: PREFIX + ep, number: epNum(a[2]) || (/(movie|film)/i.test(a[2]) ? '1' : ''), title: htmlLine(a[2]), at: a[3] ? htmlLine(a[3]) : null, views: null });
      else if (/\/batch\//.test(a[1])) batch.push({ label: 'Batch', url: a[1], resolution: null });
    }
  }
  eps.sort((x, y) => (Number(y.number) || 0) - (Number(x.number) || 0));
  const year = Number(info(html, 'Tanggal Rilis').match(/(\d{4})/)?.[1]) || null;
  return {
    ...base({
      slug, title: info(html, 'Judul') || cleanTitle(html.match(/<h1>([^<]+)/)?.[1]),
      cover: html.match(/class=['"]fotoanime[^>]*><img[^>]+src="([^"]+)"/)?.[1],
      synopsis: htmlText(html.match(/class=['"]sinopc['"]>([\s\S]*?)<\/div>/)?.[1].replace(/<\/p>\s*<p>/g, '<br><br>')) || null,
      type: info(html, 'Tipe') || null, status: status(info(html, 'Status')), year, rating: info(html, 'Skor') || null, studio: info(html, 'Studio') || null,
      genres: [...(html.match(/<b>Genre<\/b>([\s\S]*?)<\/span>/)?.[1] ?? '').matchAll(/>([^<]+)<\/a>/g)].map((x) => htmlLine(x[1])),
    }),
    altTitles: info(html, 'Japanese') || null,
    episodes: eps,
    batch,
  };
}

// ---------------------------------------------------------------- server video

const ITAG = { 18: 360, 22: 720, 37: 1080, 59: 480 };
async function resolveEmbed(url, quality, label, blogger) {
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  if (host === 'desustream.net' || host.endsWith('.desustream.net')) {
    const { text } = await fetchText(url, { ua: UA_DESKTOP, timeout: 12000, headers: { referer: BASE + '/' } });
    const t = decodeEntities(text);
    const mp4 = t.match(/https:\/\/[a-z0-9.-]+\/[^"'\s<>]+\.mp4[^"'\s<>]*/i)?.[0];
    if (mp4) return [{ label, quality, type: 'mp4', url: mediaUrl(mp4, BASE + '/') }];
    const gv = [...t.matchAll(/https:\/\/[a-z0-9.-]+googlevideo\.com\/videoplayback\?[^"'\s<>]+/g)].map((m) => m[0]);
    if (gv.length) return gv.slice(0, 1).map((u) => ({ label, quality: ITAG[Number(u.match(/[?&]itag=(\d+)/)?.[1])] ? `${ITAG[Number(u.match(/[?&]itag=(\d+)/)?.[1])]}p` : quality, type: 'mp4', url: mediaUrl(u) }));
    return [];
  }
  if (host === 'www.blogger.com' && url.includes('video.g')) return (await blogger(url, label)).map((s) => ({ ...s, quality: s.quality === 'Auto' ? quality : s.quality }));
  if (host === 'filedon.co' || host.endsWith('.filedon.co')) {
    const { text } = await fetchText(url, { ua: UA_DESKTOP, timeout: 12000, headers: { referer: BASE + '/' } });
    const data = decodeEntities(text.match(/data-page="([^"]+)"/)?.[1] ?? '').replace(/\\\//g, '/');
    const file = data.match(/"url":"(https:\/\/[^"]+\.(?:mp4|mkv|webm)\?[^"]+)"/)?.[1] ?? data.match(/"url":"(https:\/\/[^"]+\.mp4)"/)?.[1];
    return file ? [{ label, quality, type: 'mp4', url: mediaUrl(file.replace(/\\u0026/g, '&')) }] : [];
  }
  return embedSource(url, quality);
}

const ajax = async (body) => {
  const r = await fetch(BASE + '/wp-admin/admin-ajax.php', {
    method: 'POST', body: new URLSearchParams(body),
    headers: { 'user-agent': UA_DESKTOP, referer: BASE + '/', 'x-requested-with': 'XMLHttpRequest' }, signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new SourceError(`Sumber menolak (HTTP ${r.status})`);
  return (await r.json())?.data;
};

const streamCache = ttlCache(200);
const WANT = /^(odcdn|ondesu|odstream|desu|blogs?|filedon|pdrain|mega)/i;

export async function episode(id, blogger) {
  const slug = check(id);
  const html = await page(`/episode/${slug}/`, 10 * 60_000);
  const title = htmlLine(html.match(/<h1 class="posttl">([\s\S]*?)<\/h1>/)?.[1]);
  if (!title) throw new SourceError('Episode tidak ditemukan', 404);
  const animeSlug = slugOf(html.match(/<div class='flir'>[\s\S]*?<a href="([^"]+\/anime\/[^"]+)"/)?.[1], 'anime');
  const prev = slugOf(html.match(/<a href="([^"]+)"[^>]*title="Episode Sebelumnya"/)?.[1], 'episode');
  const next = slugOf(html.match(/<a href="([^"]+)"[^>]*title="Episode Selanjutnya"/)?.[1], 'episode');
  const list = [...(html.match(/id="selectcog"[\s\S]*?<\/select>/)?.[0] ?? '').matchAll(/<option value="([^"]+\/episode\/[^"]+)"[^>]*>([^<]+)/g)]
    .map((m) => ({ id: PREFIX + slugOf(m[1], 'episode'), number: epNum(m[2]) || htmlLine(m[2]), title: htmlLine(m[2]) }));
  const num = (s) => list.find((e) => e.id === PREFIX + s)?.number ?? epNum(s.replace(/-/g, ' '));

  // Tiap mirror minta tanda (nonce) lalu kode embed. Kode aksi diambil dari skrip halaman, karena bisa berganti.
  const acts = [...html.matchAll(/action:"([a-f0-9]{32})"/g)].map((m) => m[1]);
  const nonceAct = html.match(/data:\{action:"([a-f0-9]{32})"\}/)?.[1];
  const embedAct = acts.find((a) => a !== nonceAct);
  const mirrors = [];
  for (const ul of html.matchAll(/<ul class="m(\d+p)"[^>]*>([\s\S]*?)<\/ul>/g)) {
    for (const a of ul[2].matchAll(/data-content="([^"]+)"[^>]*>([^<]+)</g)) mirrors.push({ quality: ul[1], content: a[1], name: htmlLine(a[2]) });
  }
  // Pemutar bawaan halaman: cuma alamat embed-nya yang dibaca, lalu dibuka jadi berkas video.
  const iframe = html.match(/id="pembed">(?:<div[^>]*>)?<[a-z]+ src="(https:\/\/[^"]+)"/)?.[1];

  let sources = [];
  try {
    sources = await streamCache('ep:' + slug, 40 * 60_000, async () => {
      const jobs = [];
      if (iframe) jobs.push(resolveEmbed(iframe, '480p', 'ODCDN', blogger));
      const picked = mirrors.filter((m) => WANT.test(m.name));
      if (picked.length && nonceAct && embedAct) {
        const nonce = await ajax({ action: nonceAct });
        for (const m of picked) {
          jobs.push((async () => {
            let d;
            try { d = JSON.parse(Buffer.from(m.content, 'base64').toString()); } catch { return []; }
            const enc = await ajax({ ...d, nonce, action: embedAct });
            const src = Buffer.from(String(enc ?? ''), 'base64').toString().match(/src="([^"]+)"/)?.[1];
            const label = /mega/i.test(m.name) ? 'MEGA' : /cdn/i.test(m.name) ? 'ODCDN' : /desu|stream/i.test(m.name) ? 'Desustream' : /blog/i.test(m.name) ? 'Blogger' : /filedon/i.test(m.name) ? 'Filedon' : m.name;
            return src ? resolveEmbed(decodeEntities(src), m.quality, label, blogger) : [];
          })().catch(() => []));
        }
      }
      const all = (await Promise.all(jobs.map((j) => j.catch(() => [])))).flat();
      const seen = new Set();
      const out = sortSources(all.filter((s) => !seen.has(s.url) && seen.add(s.url)));
      if (!out.length) throw new Error('kosong');
      return out;
    });
  } catch { sources = []; }

  let anime = null;
  if (animeSlug) anime = await detail(PREFIX + animeSlug).then(({ episodes, batch, altTitles, ...a }) => a).catch(() => null);
  return {
    id: PREFIX + slug,
    number: num(slug),
    title: title.replace(/\s*Subtitle Indonesia\s*$/i, ''),
    anime,
    prev: prev ? { id: PREFIX + prev, number: num(prev) } : null,
    next: next ? { id: PREFIX + next, number: num(next) } : null,
    sources,
    unsupported: Math.max(0, new Set(mirrors.map((m) => m.name)).size - new Set(sources.map((s) => s.label)).size),
    downloads: [],
    episodes: list,
  };
}
