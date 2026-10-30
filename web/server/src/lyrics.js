// Lirik: LRCLIB (berwaktu, gratis, tanpa kunci) lalu lirik polos YouTube Music sebagai cadangan.
import { plainLyrics } from './youtube.js';

const cache = new Map();

function clean(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(official|music video|lyric(s)? video|video lirik|video klip|audio|mv|hd|4k|remaster(ed)?|topic)\b/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "TULUS - Hati-Hati di Jalan (Official…)" → { artist, title } */
export function splitTitle(title, artist) {
  const m = String(title).match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m && clean(m[1]).length) return { artist: m[1], title: m[2] };
  return { artist, title };
}

const UA = { 'User-Agent': 'Freease Web (https://github.com/Kodok-Kejepit/freease-music)' };
const words = (s) => clean(s).replace(/\b(feat|ft|featuring|lirik|lyrics?|cover|versi|version|live)\b.*$/, '').split(' ').filter(Boolean);

/** Berapa bagian kata-kata `a` ada di `b` (0..1). Judul satu kata dinilai lebih hati-hati. */
export function similarity(a, b) {
  const A = words(a), B = new Set(words(b));
  if (!A.length || !B.size) return 0;
  const hit = A.filter((w) => B.has(w)).length / A.length;
  return A.length === 1 && B.size > 3 ? hit * 0.7 : hit;
}

async function lrclibSearch(params) {
  const u = new URL('https://lrclib.net/api/search');
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!r.ok) return [];
  const list = await r.json();
  return Array.isArray(list) ? list : [];
}

/**
 * Cari di LRCLIB dengan beberapa kueri (judul+artis hasil pisah, lalu teks bebas yang tidak peduli urutan
 * "Artis - Judul" / "Judul - Artis"), lalu nilai tiap hasil: kemiripan judul & artis, berwaktu, selisih durasi.
 */
export async function bestLrclib({ title, artist, duration }) {
  const t = splitTitle(title, artist);
  const parts = [t.title, t.artist, title];
  const artists = [artist, t.artist, t.title];
  const queries = [
    { track_name: clean(t.title), artist_name: clean(t.artist) },
    { q: `${clean(t.artist)} ${clean(t.title)}`.trim() },
  ];
  if (t.title !== title) queries.push({ track_name: clean(t.artist), artist_name: clean(t.title) }); // urutan terbalik
  const seen = new Map();
  for (const q of queries) {
    for (const e of await lrclibSearch(q).catch(() => [])) seen.set(e.id, e);
    if ([...seen.values()].some((e) => e.syncedLyrics && score(e) > 80)) break;
  }
  function score(e) {
    const ts = Math.max(...parts.map((p) => similarity(e.trackName, p)));
    if (ts < 0.5) return -1;
    const as = Math.max(...artists.map((p) => Math.max(similarity(e.artistName, p), similarity(p, e.artistName))));
    const dd = duration && e.duration ? Math.abs(e.duration - duration) : 0;
    return ts * 40 + as * 30 + (e.syncedLyrics ? 25 : 0) - Math.min(30, dd * 1.5) + (e.instrumental ? -50 : 0);
  }
  const ranked = [...seen.values()].map((e) => ({ e, s: score(e) })).filter((x) => x.s >= 30).sort((a, b) => b.s - a.s);
  const best = ranked[0]?.e;
  if (!best || (!best.syncedLyrics && !best.plainLyrics)) return null;
  return {
    synced: best.syncedLyrics || null,
    plain: best.plainLyrics || null,
    source: 'LRCLIB',
    // Selisih durasi besar biasanya = intro/outro video klip → waktu lirik mungkin perlu digeser.
    durationDiff: duration && best.duration ? Math.round(duration - best.duration) : 0,
  };
}

export async function lyrics({ id, title, artist, duration }) {
  const key = id || `${title}|${artist}`;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  let result = null;
  try {
    result = await bestLrclib({ title, artist, duration });
  } catch { /* lanjut */ }
  if (!result && id) {
    const plain = await plainLyrics(id).catch(() => null);
    if (plain) result = { synced: null, plain, source: 'YouTube Music', durationDiff: 0 };
  }
  // Disimpan di memori saja (tidak ke disk). Hasil kosong dicoba lagi setelah 30 menit.
  cache.set(key, { value: result || { synced: null, plain: null, source: null }, until: Date.now() + (result ? 24 * 3600_000 : 30 * 60_000) });
  // Browser menyimpan lirik sendiri (IndexedDB); server cukup mengingat sedikit untuk permintaan berulang.
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return result || { synced: null, plain: null, source: null };
}
