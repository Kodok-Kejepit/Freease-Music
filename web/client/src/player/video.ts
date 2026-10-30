// Video untuk lagu YouTube. YouTube menyediakan video & audio sebagai stream terpisah (360p ke atas tidak ada
// yang gabungan), jadi audio tetap diputar elemen utama — EQ, karaoke, timer, layar kunci tetap jalan — dan
// video tanpa suara diputar di elemen kedua yang terus disamakan waktunya dengan audio.
import { create } from 'zustand';
import { api } from '../lib/api';
import { useSettings } from '../lib/settings';
import { toast } from '../lib/toast';
import { isLocalFile } from '../lib/types';
import { currentSong, media, usePlayer, videoHost } from './player';

export const useVideo = create<{ active: boolean; ready: boolean; height: number; heights: number[] }>(() => ({
  active: false, ready: false, height: 0, heights: [],
}));

export const vmedia: HTMLVideoElement = document.createElement('video');
vmedia.muted = true;
vmedia.playsInline = true;
vmedia.setAttribute('playsinline', '');
vmedia.preload = 'auto';
vmedia.className = 'media-el companion';
videoHost.appendChild(vmedia);

// Codec yang bisa diputar browser ini, yang paling hemat dulu. VP9 ±setengah ukuran H.264 untuk kualitas
// sama; AV1 sengaja tidak dipakai karena di banyak HP didekode tanpa hardware (panas & boros baterai).
const probe = document.createElement('video');
export const CODECS: string[] = [
  ['vp9', 'video/webm; codecs="vp9"'],
  ['avc1', 'video/mp4; codecs="avc1.640028"'],
].filter(([, t]) => probe.canPlayType(t) !== '' || (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(t))).map(([c]) => c);
if (!CODECS.length) CODECS.push('avc1');

/** Kualitas "otomatis": hemat data → 360p, koneksi lambat → 480p, HP → 720p, layar besar → 1080p. */
function autoHeight(): number {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (c?.saveData) return 360;
  if (c?.effectiveType && /2g|3g/.test(c.effectiveType)) return 480;
  return Math.min(screen.width, screen.height) >= 900 ? 1080 : 720;
}
export const targetHeight = () => useSettings.getState().videoQuality || autoHeight();

let failedFor = '';

function wanted(): boolean {
  const s = currentSong();
  return !!s && useSettings.getState().videoMode && usePlayer.getState().mode === 'stream' && !isLocalFile(s.id) && failedFor !== s.id;
}

function stop() {
  if (vmedia.dataset.url) {
    vmedia.pause();
    vmedia.removeAttribute('src');
    delete vmedia.dataset.url;
    vmedia.load();
  }
  videoHost.classList.remove('with-companion');
  if (useVideo.getState().active) useVideo.setState({ active: false, ready: false });
}

export function syncVideo() {
  const s = currentSong();
  if (!s || !wanted()) { stop(); return; }
  const h = targetHeight();
  const url = api.videoUrl(s.id, h, CODECS);
  if (vmedia.dataset.url !== url) {
    const keep = vmedia.dataset.url?.includes(`/video/${encodeURIComponent(s.id)}?`); // ganti kualitas lagu yang sama
    vmedia.dataset.url = url;
    vmedia.src = url;
    useVideo.setState({ active: true, ready: keep ? useVideo.getState().ready : false, height: h, ...(keep ? {} : { heights: [] }) });
    if (!keep) api.formats(s.id, CODECS).then((f) => { if (currentSong()?.id === s.id) useVideo.setState({ heights: f.heights }); }).catch(() => {});
  }
  align(true);
}

/** Samakan video dengan audio: lompat bila selisih besar, selebihnya percepat/perlambat sedikit. */
function align(force = false) {
  if (!vmedia.dataset.url || vmedia.readyState < 1) return;
  const rate = media.playbackRate || 1;
  const hidden = document.hidden && document.pictureInPictureElement !== vmedia;
  if (media.paused || hidden) {
    if (!vmedia.paused) vmedia.pause();
    if (force && !hidden) vmedia.currentTime = media.currentTime;
    return;
  }
  const drift = vmedia.currentTime - media.currentTime;
  if (force || Math.abs(drift) > 1) {
    vmedia.currentTime = media.currentTime + (vmedia.paused ? 0 : 0.05);
    vmedia.playbackRate = rate;
  } else if (Math.abs(drift) > 0.06) {
    vmedia.playbackRate = rate * (1 - Math.max(-0.5, Math.min(0.5, drift)) * 0.5);
  } else {
    vmedia.playbackRate = rate;
  }
  if (vmedia.paused) vmedia.play().catch(() => {});
}

vmedia.addEventListener('loadedmetadata', () => {
  videoHost.classList.add('with-companion');
  useVideo.setState({ ready: true });
  align(true);
});
vmedia.addEventListener('error', () => {
  if (!vmedia.dataset.url) return;
  failedFor = currentSong()?.id ?? '';
  toast('Video tidak tersedia untuk lagu ini — memutar audio saja');
  stop();
});
vmedia.addEventListener('playing', () => align());
for (const ev of ['play', 'pause', 'ratechange']) media.addEventListener(ev, () => align());
media.addEventListener('seeked', () => align(true));
document.addEventListener('visibilitychange', () => align(!document.hidden));
setInterval(() => { if (useVideo.getState().ready && !media.paused) align(); }, 500);

usePlayer.subscribe((s, p) => {
  if (s.index !== p.index || s.queue !== p.queue || s.mode !== p.mode) {
    if (s.queue[s.index]?.id !== p.queue[p.index]?.id) failedFor = '';
    syncVideo();
  }
});
useSettings.subscribe((s, p) => {
  if (s.videoMode !== p.videoMode || s.videoQuality !== p.videoQuality) syncVideo();
});

// ---------------------------------------------------------------- layar penuh
type WebkitVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

/**
 * Layar penuh untuk [host] (wadah video kita, atau player YouTube cadangan). Di HP layar diputar ke mode
 * miring untuk video horizontal. iPhone tidak mendukung layar penuh untuk elemen biasa → pemutar bawaan Safari.
 */
export async function enterFullscreen(host: HTMLElement) {
  if (document.fullscreenElement) { await document.exitFullscreen().catch(() => {}); return; }
  if (!host.requestFullscreen) {
    const v = (vmedia.dataset.url ? vmedia : media) as WebkitVideo;
    v.webkitEnterFullscreen?.();
    return;
  }
  try { await host.requestFullscreen({ navigationUI: 'hide' }); } catch { return; }
  const v = vmedia.dataset.url ? vmedia : media;
  const portrait = v.videoWidth > 0 && v.videoHeight > v.videoWidth; // video vertikal (mis. Shorts) tetap tegak
  try { await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.(portrait ? 'portrait' : 'landscape'); } catch { /* desktop / tidak didukung */ }
}
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) try { screen.orientation.unlock?.(); } catch { /* abaikan */ }
});

// Ketuk dua kali video → layar penuh.
videoHost.addEventListener('dblclick', () => void enterFullscreen(videoHost));

export function setVideoMode(on: boolean) {
  useSettings.getState().set({ videoMode: on });
}
