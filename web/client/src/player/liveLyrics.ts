// Lirik di luar halaman Freease:
//  - Lirik melayang: jendela Picture-in-Picture yang selalu di atas aplikasi lain (Chrome/Edge di HP & komputer).
//    Liriknya digambar ke <canvas>, lalu canvas itu diputar sebagai video di jendela PiP.
//  - Lirik di notifikasi & layar kunci: baris yang sedang dinyanyikan dikirim lewat Media Session.
// Keduanya tidak butuh izin khusus dari browser.
import { create } from 'zustand';
import { lineAt, loadLyrics, lyricsOffset, parseLrc, type LrcLine } from '../lib/lyrics';
import { ACCENTS, useSettings } from '../lib/settings';
import { toast } from '../lib/toast';
import { currentSong, pause, position, resume, setMediaLine, usePlayer } from './player';

export const useLiveLyrics = create<{ floating: boolean }>(() => ({ floating: false }));

let songId: string | null = null;
let lines: LrcLine[] = [];
let plain = false;
let lastSentLine: string | null = null;
let timer = 0;

async function prepare() {
  const s = currentSong();
  if (!s || s.id === songId) return;
  songId = s.id;
  lines = [];
  plain = false;
  try {
    const l = await loadLyrics(s);
    if (songId !== s.id) return;
    lines = l?.synced ? parseLrc(l.synced) : [];
    plain = !lines.length && !!l?.plain;
  } catch { /* tanpa lirik */ }
}

function textOf(i: number): string {
  const t = lines[i]?.text;
  return t && t !== '♪' ? t : '';
}

function tick() {
  void prepare();
  const idx = lineAt(lines, position() - (songId ? lyricsOffset(songId) : 0));
  if (useSettings.getState().lyricsInNotification) {
    const line = idx >= 0 ? textOf(idx) || null : null;
    if (line !== lastSentLine) { lastSentLine = line; setMediaLine(line); }
  }
  if (useLiveLyrics.getState().floating) draw(idx);
}

function syncTimer() {
  const need = useSettings.getState().lyricsInNotification || useLiveLyrics.getState().floating;
  if (need && !timer) timer = window.setInterval(tick, 250);
  if (!need && timer) { clearInterval(timer); timer = 0; }
}

useSettings.subscribe((s, p) => {
  if (s.lyricsInNotification === p.lyricsInNotification) return;
  if (!s.lyricsInNotification && lastSentLine !== null) { lastSentLine = null; setMediaLine(null); }
  syncTimer();
});
useLiveLyrics.subscribe(syncTimer);
usePlayer.subscribe((s, p) => {
  if (s.index !== p.index || s.queue !== p.queue) { lastSentLine = null; }
});
syncTimer();

// ---------------------------------------------------------------- lirik melayang (PiP)
const W = 640, H = 360;
let canvas: HTMLCanvasElement | null = null;
let video: HTMLVideoElement | null = null;

export function floatingSupported(): boolean {
  return typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled
    && typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;
}

/** Harus dipanggil dari ketukan pengguna (aturan browser untuk PiP). */
export async function toggleFloatingLyrics() {
  if (useLiveLyrics.getState().floating) { await closeFloating(); return; }
  if (!floatingSupported()) {
    toast('Browser ini belum mendukung jendela melayang. Coba Chrome, atau nyalakan "Lirik di notifikasi" di Pengaturan.');
    return;
  }
  if (!currentSong()) { toast('Putar lagu dulu'); return; }
  try {
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = canvas.captureStream(10);
      // Tombol putar/jeda di jendela melayang mengendalikan lagu, bukan video liriknya.
      video.addEventListener('pause', () => {
        if (document.pictureInPictureElement !== video) return;
        if (usePlayer.getState().playing) pause(); else resume();
        void video!.play();
      });
      video.addEventListener('leavepictureinpicture', () => useLiveLyrics.setState({ floating: false }));
    }
    useLiveLyrics.setState({ floating: true });
    draw(lineAt(lines, position() - (songId ? lyricsOffset(songId) : 0)));
    await video!.play();
    await video!.requestPictureInPicture();
  } catch (e) {
    useLiveLyrics.setState({ floating: false });
    toast('Lirik melayang tidak bisa dibuka di browser ini');
    console.warn(e);
  }
}

async function closeFloating() {
  useLiveLyrics.setState({ floating: false });
  if (document.pictureInPictureElement === video) await document.exitPictureInPicture().catch(() => {});
}

function wrap(g: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of text.split(/\s+/)) {
    const t = cur ? `${cur} ${w}` : w;
    if (g.measureText(t).width > max && cur) { out.push(cur); cur = w; } else cur = t;
  }
  if (cur) out.push(cur);
  return out;
}

function draw(idx: number) {
  if (!canvas) return;
  const g = canvas.getContext('2d')!;
  const s = currentSong();
  const acc = ACCENTS[useSettings.getState().accent] ?? ACCENTS[0];
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#121212');
  bg.addColorStop(1, acc.a + '55');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,255,255,.55)';
  g.font = '600 20px system-ui, sans-serif';
  const head = s ? `${s.title} · ${s.artist}` : 'Freease';
  g.fillText(head.length > 52 ? head.slice(0, 51) + '…' : head, W / 2, 30);

  let main = '', nextText = '';
  if (!s) main = 'Freease';
  else if (!lines.length) main = plain ? 'Lirik ini tidak berwaktu — buka di Freease' : 'Lirik belum tersedia';
  else if (idx < 0) { main = '• • •'; nextText = textOf(0); }
  else { main = textOf(idx) || '• • •'; nextText = textOf(idx + 1); }

  g.fillStyle = '#fff';
  g.font = '800 40px system-ui, sans-serif';
  const rows = wrap(g, main, W - 60).slice(0, 3);
  const top = H / 2 - ((rows.length - 1) * 48) / 2 - (nextText ? 20 : 0);
  rows.forEach((r, i) => g.fillText(r, W / 2, top + i * 48));
  if (nextText) {
    g.fillStyle = 'rgba(255,255,255,.5)';
    g.font = '600 24px system-ui, sans-serif';
    const n = wrap(g, nextText, W - 80)[0] ?? '';
    g.fillText(n, W / 2, top + rows.length * 48 + 18);
  }

  // Bilah posisi lagu
  const d = usePlayer.getState().duration;
  const frac = d > 0 ? Math.min(1, position() / d) : 0;
  g.fillStyle = 'rgba(255,255,255,.15)';
  g.fillRect(40, H - 22, W - 80, 4);
  const pg = g.createLinearGradient(40, 0, W - 40, 0);
  pg.addColorStop(0, acc.a); pg.addColorStop(1, acc.b);
  g.fillStyle = pg;
  g.fillRect(40, H - 22, (W - 80) * frac, 4);
}
