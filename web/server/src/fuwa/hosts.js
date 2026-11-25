// Server video yang memutar HLS (m3u8) di balik pemutar berisi iklan: VidHide, Streamruby, Mecdn (JS terkemas),
// Vidara (API stream), Dailymotion (metadata), D-Tube. Daftar putarnya dibuka di sini lalu diputar lewat proxy HLS
// Freease (tanpa iklan, tanpa iframe). Tiap hasil diperiksa: master m3u8 harus benar-benar terbaca.
import { fetchText, decodeEntities, UA_DESKTOP } from './net.js';
import { hlsUrl, mediaUrl } from './media.js';

/** Buka JS terkemas `eval(function(p,a,c,k,e,d)…)` (Dean Edwards packer). */
export function unpack(src) {
  const m = String(src).match(/}\('(.*)',\s*(\d+),\s*(\d+),\s*'(.*?)'\.split\('\|'\)/s);
  if (!m) return null;
  let [, p, a, c, k] = m;
  a = Number(a); c = Number(c); k = k.split('|');
  if (!(a >= 2 && a <= 62) || c > 50000) return null;
  const enc = (n) => (n < a ? '' : enc(Math.floor(n / a))) + ((n %= a) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
  const dict = new Map();
  while (c--) dict.set(enc(c), k[c] || enc(c));
  return p.replace(/\b\w+\b/g, (w) => dict.get(w) ?? w).replace(/\\'/g, "'");
}

const origin = (u) => { try { return new URL(u).origin + '/'; } catch { return ''; } };

/** Periksa master/daftar m3u8 lalu jadikan sumber `hls`; kualitas = resolusi tertinggi di master. */
async function hlsSource(m3u8, referer, label, quality) {
  const { text } = await fetchText(m3u8, { ua: UA_DESKTOP, timeout: 12000, headers: { referer, origin: referer.replace(/\/$/, '') } });
  if (!text.trimStart().startsWith('#EXTM3U')) return [];
  const heights = [...text.matchAll(/RESOLUTION=\d+x(\d+)/g)].map((m) => Number(m[1]));
  const q = heights.length ? `${Math.max(...heights)}p` : quality;
  return [{ label, quality: q, type: 'hls', url: hlsUrl(m3u8, referer) }];
}

/** Halaman pemutar jwplayer biasa: m3u8 terlihat langsung, atau tersembunyi di JS terkemas. */
async function packedPage(url, label, quality, referer) {
  const { text, url: final } = await fetchText(url, { ua: UA_DESKTOP, timeout: 12000, headers: referer ? { referer } : {} });
  const blobs = [text, ...[...text.matchAll(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?\.split\('\|'\)[^)]*\)\)/g)].map((m) => unpack(m[0]) ?? '')];
  for (const b of blobs) {
    const s = decodeEntities(b).replace(/\\\//g, '/');
    const found = s.match(/"hls\d"\s*:\s*"(https:[^"]+\.m3u8[^"]*)"/)?.[1]
      ?? s.match(/file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/)?.[1]
      ?? s.match(/sources\s*:\s*\[\s*\{\s*(?:src|file)\s*:\s*["']([^"']+\.m3u8[^"']*)/)?.[1]
      ?? s.match(/https:\/\/[^"'\s<>\\]+\.m3u8[^"'\s<>\\]*/)?.[0];
    if (found) return hlsSource(new URL(found, final).href, origin(final), label, quality);
    // Sebagian pemutar jwplayer memberi berkas MP4 biasa (misalnya Mecdn → rumble.cloud).
    const mp4 = s.match(/file\s*:\s*["'](https?:[^"']+\.mp4[^"']*)["'][^}]*?(?:label\s*:\s*["'](\d{3,4})p?)?/);
    if (mp4) return [{ label, quality: mp4[2] ? `${mp4[2]}p` : quality, type: 'mp4', url: mediaUrl(mp4[1], origin(final)) }];
  }
  return [];
}

async function vidara(url, label, quality) {
  const u = new URL(url);
  const code = u.pathname.match(/\/[ev]\/([A-Za-z0-9]+)/)?.[1];
  if (!code) return [];
  const r = await fetch(u.origin + '/api/stream', {
    method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA_DESKTOP, referer: url },
    body: JSON.stringify({ filecode: code, device: 'web', codecs: [] }), signal: AbortSignal.timeout(12000),
  });
  const j = r.ok ? await r.json().catch(() => null) : null;
  return j?.streaming_url ? hlsSource(j.streaming_url, u.origin + '/', label, quality) : [];
}

async function dailymotion(id, label, quality) {
  if (!/^[a-z0-9]{5,24}$/i.test(id)) return [];
  const { text } = await fetchText(`https://www.dailymotion.com/player/metadata/video/${id}`, { ua: UA_DESKTOP, timeout: 12000, headers: { referer: 'https://geo.dailymotion.com/' } });
  let j; try { j = JSON.parse(text); } catch { return []; }
  const m3u8 = j?.qualities?.auto?.find((q) => /mpegurl/i.test(q.type))?.url;
  return m3u8 ? hlsSource(m3u8, 'https://www.dailymotion.com/', label, quality) : [];
}

async function dtube(id, label, quality) {
  if (!/^[a-z0-9-]{8,64}$/i.test(id)) return [];
  for (const nas of ['https://nas1.d.tube', 'https://nas2.d.tube']) {
    const out = await hlsSource(`${nas}/videos/${id}/master.m3u8`, 'https://play.d.tube/', label, quality).catch(() => []);
    if (out.length) return out;
  }
  return [];
}

/** Host yang dikenal di sini? Dipakai juga untuk memutuskan mirror mana yang layak diminta. */
export const HLS_HOST = /(vidhide|morencius|streamruby|nuvorel|mecdn\.website|vidara|oisauh|dailymotion|nunadrama|d\.tube|filelions|smoothpre|dhcplay|movearnpre)/i;

/** URL pemutar → sumber HLS lewat proxy Freease, atau [] kalau tidak bisa dibuka. */
export async function resolveHls(url, label, quality = 'Auto', referer = '') {
  let u;
  try { u = new URL(url); } catch { return []; }
  const h = u.hostname;
  if (/(^|\.)nunadrama\./.test(h) || /dailymotion\.com$/.test(h)) {
    const id = u.searchParams.get('video') ?? u.pathname.match(/\/(?:video|embed\/video)\/([a-z0-9]+)/i)?.[1];
    return id ? dailymotion(id, label, quality) : [];
  }
  if (/(^|\.)d\.tube$/.test(h)) return dtube(u.searchParams.get('v') ?? u.pathname.split('/').filter(Boolean).pop() ?? '', label, quality);
  if (/vidara|oisauh/.test(h)) return vidara(url, label, quality);
  return packedPage(url, label, quality, referer);
}
