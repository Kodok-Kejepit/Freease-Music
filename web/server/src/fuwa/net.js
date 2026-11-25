// Pengambil halaman/JSON untuk Freease Stream: batas waktu, cache kecil di memori, dan teks HTML ke teks biasa.

export const UA_MOBILE = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
export const UA_DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export class SourceError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

/** GET dengan batas waktu; galat HTTP jadi SourceError berpesan jelas. */
export async function fetchText(url, { headers = {}, timeout = 15000, ua = UA_MOBILE, allowStatus = false } = {}) {
  let r;
  try {
    r = await fetch(url, { headers: { 'user-agent': ua, 'accept-language': 'id-ID,id;q=0.9,en;q=0.8', ...headers }, redirect: 'follow', signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    throw new SourceError(e.name === 'TimeoutError' ? 'Sumber terlalu lama menjawab' : 'Sumber tidak bisa dihubungi');
  }
  const text = await r.text();
  if (!r.ok && !allowStatus) throw new SourceError(r.status === 404 ? 'Tidak ditemukan di sumber' : `Sumber menolak (HTTP ${r.status})`, r.status === 404 ? 404 : 502);
  if (/<title>Just a moment\.\.\.<\/title>/.test(text)) throw new SourceError('Sumber sedang memblokir server (Cloudflare)', 503);
  return { text, url: r.url, status: r.status };
}

export async function fetchJson(url, opts = {}) {
  const { text } = await fetchText(url, { ...opts, headers: { accept: 'application/json', ...(opts.headers || {}) } });
  try { return JSON.parse(text); } catch { throw new SourceError('Jawaban sumber tidak terbaca'); }
}

/** Cache TTL berukuran tetap (urutan sisip Map = yang tertua dibuang dulu). Janji yang sedang jalan ikut dibagi. */
export function ttlCache(max = 300) {
  const m = new Map();
  return async (key, ttlMs, load) => {
    const hit = m.get(key);
    if (hit && hit.exp > Date.now()) return hit.v;
    const v = load();
    m.set(key, { v, exp: Date.now() + ttlMs });
    if (m.size > max) m.delete(m.keys().next().value);
    try { return await v; } catch (e) { m.delete(key); throw e; }
  };
}

/** Jalankan dengan batas waktu; gagal/terlambat → nilai cadangan (untuk gabungan banyak sumber). */
export async function quiet(p, ms, fallback) {
  let t;
  try {
    return await Promise.race([p, new Promise((res) => { t = setTimeout(() => res(fallback), ms); })]);
  } catch { return fallback; } finally { clearTimeout(t); }
}

const NAMED = { amp: '&', quot: '"', lt: '<', gt: '>', nbsp: ' ', apos: "'", rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', ndash: '–', mdash: '—' };
export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, v) => {
    if (v[0] === '#') {
      const n = v[1] === 'x' || v[1] === 'X' ? parseInt(v.slice(2), 16) : parseInt(v.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return NAMED[v.toLowerCase()] ?? m;
  });
}

/** Fragmen HTML → teks: <br> jadi baris baru, tag dibuang, spasi dirapikan. */
export function htmlText(s) {
  return decodeEntities(String(s ?? '').replace(/\s*<br\s*\/?>\s*/gi, '\n').replace(/<[^>]+>/g, ''))
    .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
export const htmlLine = (s) => htmlText(s).replace(/\s+/g, ' ');

/** Judul diringkas ke huruf+angka kecil, supaya "Mu Shen Ji" = "Mushen Ji!". */
export const titleKey = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export function sameTitle(a, b, alts = []) {
  const want = titleKey(a);
  if (!want) return false;
  return titleKey(b) === want || (want.length >= 5 && alts.some((x) => titleKey(x) === want));
}
