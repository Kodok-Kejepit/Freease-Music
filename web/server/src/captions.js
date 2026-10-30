// Subtitle video YouTube (format json3 YouTube → potongan { s, e, t } dalam detik), termasuk terjemahan
// otomatis YouTube ke bahasa Indonesia. Bila terjemahan YouTube tidak tersedia, subtitle aslinya
// diterjemahkan lewat translate.js.
import { resolve } from './stream.js';
import { translateLines } from './translate.js';

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' };

export function parseJson3(j) {
  const cues = [];
  for (const ev of j?.events || []) {
    if (!ev.segs || ev.tStartMs == null) continue;
    const t = ev.segs.map((s) => s.utf8 || '').join('').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const s = ev.tStartMs / 1000;
    cues.push({ s, e: s + (ev.dDurationMs || 2000) / 1000, t });
  }
  // Subtitle otomatis (ASR) bertumpuk; potong akhir tiap baris di awal baris berikutnya.
  for (let i = 0; i < cues.length - 1; i++) if (cues[i].e > cues[i + 1].s) cues[i].e = cues[i + 1].s;
  return cues;
}

async function fetchTrack(url) {
  const u = new URL(url);
  u.searchParams.set('fmt', 'json3');
  const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return parseJson3(await r.json());
}

/** Daftar subtitle yang tersedia (tanpa URL) untuk ditampilkan di klien. */
export async function captionList(id) {
  const m = (await resolve(id)).meta || {};
  return (m.captions || []).map(({ lang, name, kind }) => ({ lang, name, kind }));
}

/**
 * Subtitle [lang] untuk video [id]. lang = 'id' (Indonesia, terjemahan bila perlu), 'orig' (bahasa asli),
 * atau kode bahasa subtitle yang tersedia.
 */
export async function captions(id, lang) {
  const m = (await resolve(id)).meta || {};
  const tracks = m.captions || [];
  if (!tracks.length) throw Object.assign(new Error('Video ini tidak punya subtitle'), { status: 404 });
  const manual = tracks.filter((t) => t.kind === 'manual');
  const original = manual.find((t) => t.lang === m.language) || tracks.find((t) => t.kind === 'asr') || manual[0] || tracks[0];
  if (lang !== 'id') {
    const t = lang === 'orig' ? original : tracks.find((x) => x.lang === lang) || original;
    return { lang: t.lang, name: t.name, translated: false, cues: await fetchTrack(t.url) };
  }
  const own = manual.find((t) => /^id\b/.test(t.lang));
  if (own) return { lang: 'id', name: own.name, translated: false, cues: await fetchTrack(own.url) };
  // Terjemahan otomatis YouTube (tlang=id) dari subtitle asli.
  try {
    const u = new URL(original.url);
    u.searchParams.set('tlang', 'id');
    return { lang: 'id', name: 'Indonesia (terjemahan otomatis)', translated: true, cues: await fetchTrack(u.toString()) };
  } catch { /* lanjut: terjemahkan sendiri */ }
  const cues = await fetchTrack(original.url);
  const { lines } = await translateLines(cues.map((c) => c.t), 'id');
  return { lang: 'id', name: 'Indonesia (terjemahan)', translated: true, cues: cues.map((c, i) => ({ ...c, t: lines[i] || c.t })) };
}
