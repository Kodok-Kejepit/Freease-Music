// SponsorBlock (selalu aktif): lewati sponsor, promosi & ajakan subscribe yang direkam langsung di dalam video
// oleh pembuatnya, plus bagian non-musik di video musik — supaya yang diputar benar-benar bersih dari iklan. Data diambil langsung oleh browser dari sponsor.ajay.app (tidak lewat VPS). Hanya 4 huruf
// awal hash id video yang dikirim, jadi layanan itu tidak tahu persis video yang ditonton.
import { toast } from '../lib/toast';
import { isLocalFile } from '../lib/types';
import { currentSong, media, seek, usePlayer } from './player';

type Seg = { s: number; e: number; cat: string };
let segs: Seg[] = [];
let forId = '';
const skipped = new Set<string>();

const LABEL: Record<string, string> = {
  sponsor: 'Sponsor', selfpromo: 'Promosi', interaction: 'Ajakan subscribe', intro: 'Intro', outro: 'Penutup',
  preview: 'Cuplikan', music_offtopic: 'Bagian non-musik',
};

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function load() {
  const s = currentSong();
  segs = [];
  forId = '';
  if (!s || isLocalFile(s.id) || !crypto?.subtle) return;
  const id = s.id;
  forId = id;
  const cats = s.yt ? ['sponsor', 'selfpromo', 'interaction'] : ['sponsor', 'selfpromo', 'interaction', 'music_offtopic'];
  try {
    const prefix = (await sha256Hex(id)).slice(0, 4);
    const r = await fetch(`https://sponsor.ajay.app/api/skipSegments/${prefix}?categories=${encodeURIComponent(JSON.stringify(cats))}`);
    if (!r.ok) return;
    const list: { videoID: string; segments: { segment: [number, number]; category: string }[] }[] = await r.json();
    if (forId !== id) return;
    segs = (list.find((v) => v.videoID === id)?.segments || []).map((x) => ({ s: x.segment[0], e: x.segment[1], cat: x.category })).filter((x) => x.e - x.s >= 1);
  } catch { /* tanpa SponsorBlock */ }
}

media.addEventListener('timeupdate', () => {
  if (!segs.length) return;
  const t = media.currentTime;
  for (const g of segs) {
    if (t >= g.s && t < g.e - 0.5) {
      const k = `${forId}:${g.s}`;
      if (skipped.has(k)) continue; // pengguna kembali ke bagian ini sendiri → biarkan
      skipped.add(k);
      seek(g.e);
      toast(`${LABEL[g.cat] ?? 'Bagian'} dilewati (SponsorBlock)`);
      return;
    }
  }
});

usePlayer.subscribe((s, p) => { if (s.index !== p.index || s.queue !== p.queue) void load(); });
