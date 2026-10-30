// Mesin pemutar Freease Web: satu <audio> (lewat server / unduhan / berkas lokal) dengan grafik Web Audio
// (EQ, bass, karaoke), atau player YouTube resmi sebagai cadangan bila server diblokir.
import { create } from 'zustand';
import { api, art } from '../lib/api';
import * as db from '../lib/db';
import { EQ_FREQS, useSettings } from '../lib/settings';
import { toast } from '../lib/toast';
import { isLocalFile, type Song } from '../lib/types';
import { buildKaraoke, type KaraokeGraph } from './karaoke';

export type Repeat = 'off' | 'all' | 'one';
// Tanpa player YouTube resmi sama sekali: semua diputar dari file mentah lewat server (100% tanpa iklan).
export type Mode = 'stream' | 'file' | 'offline' | null;

export interface PlayerState {
  queue: Song[];
  index: number;
  from: string;
  playing: boolean;
  buffering: boolean;
  duration: number;
  mode: Mode;
  shuffle: boolean;
  repeat: Repeat;
  volume: number;
  speed: number;
  keepPitch: boolean;
  karaoke: boolean;
  hasVideo: boolean;
  sleepAt: number | null;
  sleepEndOfSong: boolean;
}

export const usePlayer = create<PlayerState>(() => ({
  queue: [],
  index: -1,
  from: '',
  playing: false,
  buffering: false,
  duration: 0,
  mode: null,
  shuffle: false,
  repeat: 'off',
  volume: Number(localStorage.getItem('freease-volume') ?? 1),
  speed: 1,
  keepPitch: true,
  karaoke: false,
  hasVideo: false,
  sleepAt: null,
  sleepEndOfSong: false,
}));

const set = usePlayer.setState;
const get = usePlayer.getState;
export const currentSong = () => {
  const s = get();
  return s.queue[s.index] ?? null;
};

// ---------------------------------------------------------------- elemen & grafik audio
export const media: HTMLVideoElement = document.createElement('video');
media.preload = 'auto';
media.playsInline = true;
media.setAttribute('playsinline', '');
media.className = 'media-el';
/** Wadah video tetap di <body> (lihat VideoSlot). */
export const videoHost: HTMLDivElement = document.createElement('div');
videoHost.className = 'video-host';
videoHost.appendChild(media);
document.body.appendChild(videoHost);

/** Berkas yang dibuka dari perangkat (id "file:…") → File. */
const localFiles = new Map<string, File>();
let objectUrl: string | null = null;

let ctx: AudioContext | null = null;
let eqNodes: BiquadFilterNode[] = [];
let bassNode: BiquadFilterNode | null = null;
let master: GainNode | null = null;
let normal: GainNode | null = null; // jalur stereo biasa
let karaokeOut: GainNode | null = null; // jalur tanpa vokal
let vocalBack: GainNode | null = null; // sebagian vokal asli dikembalikan
let karaoke: KaraokeGraph | null = null;
let balanceTimer = 0;
let monoWarned = '';

/** Dibangun saat pemutaran pertama (butuh gestur pengguna). */
function ensureGraph() {
  if (ctx) return;
  try {
    ctx = new AudioContext();
    const src = ctx.createMediaElementSource(media);
    master = ctx.createGain();
    bassNode = ctx.createBiquadFilter();
    bassNode.type = 'lowshelf';
    bassNode.frequency.value = 110;
    eqNodes = EQ_FREQS.map((f, i) => {
      const n = ctx!.createBiquadFilter();
      n.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
      n.frequency.value = f;
      n.Q.value = 1.1;
      return n;
    });
    // Rantai: [jalur biasa | jalur karaoke] → EQ → bass → master → speaker
    let chain: AudioNode = eqNodes[0];
    for (let i = 1; i < eqNodes.length; i++) { chain.connect(eqNodes[i]); chain = eqNodes[i]; }
    chain.connect(bassNode);
    bassNode.connect(master);
    master.connect(ctx.destination);

    normal = ctx.createGain();
    src.connect(normal);
    normal.connect(eqNodes[0]);

    // Karaoke cepat (tanpa AI) — lihat karaoke.ts.
    karaoke = buildKaraoke(ctx, src);
    karaokeOut = ctx.createGain();
    karaoke.out.connect(karaokeOut);
    karaokeOut.connect(eqNodes[0]);
    vocalBack = ctx.createGain();
    karaoke.mid.connect(vocalBack);
    vocalBack.connect(eqNodes[0]);
    applyAudioSettings();
  } catch (e) {
    console.warn('Web Audio tidak tersedia', e);
    ctx = null;
  }
}

/** Terapkan EQ, bass, dan karaoke dari pengaturan & status pemutar. */
export function applyAudioSettings() {
  if (!ctx || !normal || !karaokeOut || !vocalBack || !bassNode || !master) return;
  const s = useSettings.getState();
  const t = ctx.currentTime;
  eqNodes.forEach((n, i) => n.gain.setTargetAtTime(s.eqEnabled ? s.eqBands[i] ?? 0 : 0, t, 0.05));
  bassNode.gain.setTargetAtTime(s.eqEnabled ? s.bass : 0, t, 0.05);
  // Ruang kepala supaya EQ/bass yang dinaikkan tidak pecah.
  const boost = s.eqEnabled ? Math.max(0, s.bass, ...s.eqBands) : 0;
  master.gain.setTargetAtTime(Math.pow(10, -Math.min(boost, 12) * 0.6 / 20), t, 0.05);
  const k = get().karaoke;
  normal.gain.setTargetAtTime(k ? 0 : 1, t, 0.05);
  karaokeOut.gain.setTargetAtTime(k ? 1 : 0, t, 0.05);
  vocalBack.gain.setTargetAtTime(k ? s.karaokeVocal / 100 : 0, t, 0.05);
  clearInterval(balanceTimer);
  if (k) {
    balanceTimer = window.setInterval(() => {
      if (!karaoke || !get().playing) return;
      const ratio = karaoke.balance();
      const id = currentSong()?.id ?? '';
      if (ratio < 0.12 && media.currentTime > 3 && monoWarned !== id) {
        monoWarned = id;
        toast('Lagu ini dicampur hampir mono: vokal dikurangi, tapi tidak bisa hilang total');
      }
    }, 500);
  }
}
useSettings.subscribe((s) => {
  if (s.eqEnabled && !ctx && currentSong()) ensureGraph();
  applyAudioSettings();
});

// ---------------------------------------------------------------- posisi
export function position(): number {
  return media.currentTime || 0;
}
export function seek(sec: number) {
  media.currentTime = Math.max(0, sec);
  updatePositionState();
}

// ---------------------------------------------------------------- waktu dengar & riwayat
let listenedMs = 0;
let tracked: Song | null = null;
let lastTick = 0;
setInterval(() => {
  const s = get();
  const now = Date.now();
  if (s.playing && lastTick) listenedMs += now - lastTick;
  lastTick = s.playing ? now : 0;
  checkSleep();
  if (s.playing) updatePositionState();
}, 1000);

function flushListening() {
  const s = tracked;
  const ms = listenedMs;
  listenedMs = 0;
  if (s && ms >= 15_000 && !isLocalFile(s.id)) db.recordPlay(s, ms).catch(() => {});
}

// ---------------------------------------------------------------- memuat lagu
let loadToken = 0;

async function loadCurrent(autoplay = true): Promise<void> {
  const s = currentSong();
  flushListening();
  tracked = s;
  if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
  if (!s) { media.removeAttribute('src'); media.load(); set({ playing: false, mode: null }); return; }
  const token = ++loadToken;
  set({ duration: s.duration || 0, buffering: true, hasVideo: false });
  updateMediaSession(s);
  if (!isLocalFile(s.id)) db.touchSong(s).catch(() => {});

  // 1. Berkas dari perangkat
  const file = localFiles.get(s.id);
  if (file) return startMedia(URL.createObjectURL(file), 'file', autoplay, true);
  // 2. Unduhan offline
  const dl = await db.getDownload(s.id).catch(() => undefined);
  if (token !== loadToken) return;
  if (dl) return startMedia(URL.createObjectURL(dl.blob), 'offline', autoplay, true);
  // 3. Lewat server (file mentah dari YouTube, tanpa iklan)
  if (isLocalFile(s.id)) { toast('Berkas ini perlu dibuka lagi dari perangkat'); return next(true); }
  startMedia(api.streamUrl(s.id, useSettings.getState().audioQuality === 'low'), 'stream', autoplay, false);
}

function startMedia(url: string, mode: Mode, autoplay: boolean, isObject: boolean) {
  if (isObject) objectUrl = url;
  set({ mode });
  media.src = url;
  media.playbackRate = get().speed;
  media.preservesPitch = get().keepPitch;
  media.volume = get().volume;
  if (autoplay) resume();
}

let retriedId = '';
let failStreak = 0;
/**
 * Lagu/video gagal diambil server → coba sekali lagi; kalau tetap gagal, lewati (tidak pernah dialihkan ke
 * player YouTube resmi, karena player itu bisa menayangkan iklan). Berhenti setelah 3 kegagalan beruntun.
 */
function failAndSkip(msg: string) {
  failStreak++;
  if (failStreak >= 3) {
    failStreak = 0;
    pause();
    toast('Beberapa lagu gagal diputar berturut-turut — server mungkin sedang dibatasi YouTube, coba lagi nanti');
    return;
  }
  toast(msg);
  setTimeout(() => void next(true), 1200);
}
media.addEventListener('error', async () => {
  const s = currentSong();
  if (!s || get().mode !== 'stream') return;
  const token = loadToken;
  const r = await api.playable(s.id).catch(() => ({ ok: false, blocked: false } as { ok: boolean; blocked?: boolean }));
  if (token !== loadToken) return;
  if (r.ok && retriedId !== s.id) {
    // Server sanggup → mungkin gangguan sesaat; coba sekali lagi saja (jangan berulang tanpa henti).
    retriedId = s.id;
    media.load();
    resume();
    return;
  }
  failAndSkip(r.blocked ? 'Server sedang dibatasi YouTube — lagu ini dilewati' : 'Lagu ini tidak bisa diputar — dilewati');
});
media.addEventListener('playing', () => { failStreak = 0; set({ playing: true, buffering: false }); });
media.addEventListener('pause', () => set({ playing: false }));
media.addEventListener('waiting', () => set({ buffering: true }));
media.addEventListener('canplay', () => set({ buffering: false }));
media.addEventListener('loadedmetadata', () => set({ duration: media.duration || get().duration, hasVideo: media.videoWidth > 0 }));
media.addEventListener('ended', () => onEnded());

// ---------------------------------------------------------------- kontrol
export function resume() {
  // Grafik Web Audio hanya dibuat bila EQ/karaoke dipakai: di beberapa HP (iOS) audio lewat Web Audio
  // berhenti saat layar mati, jadi pemutaran biasa tetap memakai jalur bawaan browser.
  if (!ctx && (useSettings.getState().eqEnabled || get().karaoke)) ensureGraph();
  ctx?.resume();
  media.play().catch((e) => { if (e.name !== 'AbortError') set({ playing: false }); });
}
export function pause() {
  media.pause();
  set({ playing: false });
}
export function toggle() {
  if (get().playing) pause(); else if (currentSong()) resume();
}

/** Putar [songs] mulai [start]. */
export function play(songs: Song[], start = 0, from = '', shuffle = false) {
  if (!songs.length) return;
  let queue = songs.slice(0, 1000);
  let index = Math.max(0, Math.min(start, queue.length - 1));
  if (shuffle) {
    const first = queue[Math.floor(Math.random() * queue.length)];
    queue = [first, ...shuffled(queue.filter((s) => s !== first))];
    index = 0;
  }
  original = null;
  set({ queue, index, from, shuffle });
  loadCurrent(true);
}

export function playNext(songs: Song[]) {
  const s = get();
  if (s.index < 0) return play(songs);
  const q = [...s.queue];
  q.splice(s.index + 1, 0, ...songs);
  set({ queue: q });
}
export function addToQueue(songs: Song[]) {
  const s = get();
  if (s.index < 0) return play(songs);
  set({ queue: [...s.queue, ...songs] });
}
export function removeAt(i: number) {
  const s = get();
  if (i === s.index) return;
  const q = s.queue.filter((_, k) => k !== i);
  set({ queue: q, index: i < s.index ? s.index - 1 : s.index });
}
export function move(from: number, to: number) {
  const s = get();
  if (from === to || to < 0 || to >= s.queue.length) return;
  const q = [...s.queue];
  const [x] = q.splice(from, 1);
  q.splice(to, 0, x);
  let index = s.index;
  if (from === s.index) index = to;
  else if (from < s.index && to >= s.index) index--;
  else if (from > s.index && to <= s.index) index++;
  set({ queue: q, index });
}
export function skipTo(i: number) {
  if (i < 0 || i >= get().queue.length) return;
  set({ index: i });
  loadCurrent(true);
}
export function clearUpcoming() {
  const s = get();
  set({ queue: s.queue.slice(0, s.index + 1) });
}

let autoplayBusy = false;
/** Lanjutan otomatis: video YouTube → video terkait YouTube (tetap di layar tonton); lagu → radio YouTube Music. */
async function relatedOf(cur: Song): Promise<Song[]> {
  const list = await api.related(cur.id, !!cur.yt);
  return cur.yt ? list.map((x) => ({ ...x, yt: true })) : list;
}

export async function next(auto = false): Promise<void> {
  const s = get();
  if (s.index < s.queue.length - 1) { set({ index: s.index + 1 }); return loadCurrent(true); }
  if (s.repeat === 'all' && s.queue.length) { set({ index: 0 }); return loadCurrent(true); }
  const cur = currentSong();
  if (useSettings.getState().autoplay && cur && !isLocalFile(cur.id) && !autoplayBusy) {
    autoplayBusy = true;
    try {
      const have = new Set(get().queue.map((x) => x.id));
      const more = (await relatedOf(cur)).filter((x) => !have.has(x.id)).slice(0, 25);
      if (more.length) {
        set({ queue: [...get().queue, ...more], index: get().index + 1 });
        return loadCurrent(true);
      }
    } catch { /* tidak ada rekomendasi */ } finally { autoplayBusy = false; }
  }
  if (auto) { pause(); seek(0); }
}
export function prev() {
  if (position() > 4) return seek(0);
  const s = get();
  if (s.index > 0) { set({ index: s.index - 1 }); loadCurrent(true); } else seek(0);
}

function onEnded() {
  if (get().sleepEndOfSong) { set({ sleepEndOfSong: false }); pause(); toast('Timer tidur: musik dihentikan'); return; }
  if (get().repeat === 'one') { seek(0); resume(); return; }
  next(true);
}

// Isi antrean berikutnya lebih awal supaya "putar otomatis" tidak berhenti.
usePlayer.subscribe((s, p) => {
  if (s.index !== p.index && s.index >= s.queue.length - 2) {
    const cur = currentSong();
    if (useSettings.getState().autoplay && s.repeat === 'off' && cur && !isLocalFile(cur.id) && !autoplayBusy) {
      autoplayBusy = true;
      const have = new Set(s.queue.map((x) => x.id));
      relatedOf(cur).then((more) => {
        const add = more.filter((x) => !have.has(x.id)).slice(0, 20);
        if (add.length && get().index >= get().queue.length - 2) set({ queue: [...get().queue, ...add] });
      }).catch(() => {}).finally(() => { autoplayBusy = false; });
    }
  }
});

let original: Song[] | null = null;
function shuffled<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}
export function toggleShuffle() {
  const s = get();
  const cur = currentSong();
  if (!s.shuffle) {
    original = s.queue;
    const rest = shuffled(s.queue.filter((_, i) => i !== s.index));
    set({ shuffle: true, queue: cur ? [cur, ...rest] : rest, index: cur ? 0 : -1 });
  } else {
    const base = original ?? s.queue;
    original = null;
    set({ shuffle: false, queue: base, index: cur ? Math.max(0, base.findIndex((x) => x.id === cur.id)) : -1 });
  }
}
export function cycleRepeat() {
  const order: Repeat[] = ['off', 'all', 'one'];
  set({ repeat: order[(order.indexOf(get().repeat) + 1) % 3] });
}
export function setVolume(v: number) {
  const vol = Math.max(0, Math.min(1, v));
  media.volume = vol;
  localStorage.setItem('freease-volume', String(vol));
  set({ volume: vol });
}
export function setSpeed(speed: number, keepPitch = get().keepPitch) {
  media.playbackRate = speed;
  media.preservesPitch = keepPitch;
  set({ speed, keepPitch });
}
export function setKaraoke(on: boolean) {
  ensureGraph();
  if (!ctx) { toast('Browser ini tidak mendukung karaoke'); return; }
  void ctx.resume();
  set({ karaoke: on });
  applyAudioSettings();
}

// ---------------------------------------------------------------- timer tidur
export function setSleep(minutes: number | 'end' | null) {
  if (minutes === 'end') set({ sleepAt: null, sleepEndOfSong: true });
  else set({ sleepAt: minutes ? Date.now() + minutes * 60_000 : null, sleepEndOfSong: false });
}
let fadingSleep = false;
function checkSleep() {
  const at = get().sleepAt;
  if (!at || fadingSleep) return;
  if (Date.now() >= at) {
    fadingSleep = true;
    const startVol = get().volume;
    let step = 0;
    const iv = setInterval(() => {
      step++;
      media.volume = Math.max(0, startVol * (1 - step / 20));
      if (step >= 20) {
        clearInterval(iv);
        pause();
        setVolume(startVol);
        set({ sleepAt: null });
        fadingSleep = false;
        toast('Timer tidur: musik dihentikan');
      }
    }, 500);
  }
}

// ---------------------------------------------------------------- berkas dari perangkat
export function addLocalFiles(files: File[]): Song[] {
  return files.filter((f) => /^(audio|video)\//.test(f.type) || /\.(mp3|m4a|aac|flac|ogg|opus|wav|webm|mp4|mkv|mov|3gp)$/i.test(f.name)).map((f) => {
    const id = `file:${f.name}:${f.size}:${f.lastModified}`;
    localFiles.set(id, f);
    const base = f.name.replace(/\.[^.]+$/, '');
    const m = base.match(/^(.+?)\s+-\s+(.+)$/);
    return { id, title: m ? m[2] : base, artist: m ? m[1] : 'Berkas di perangkat', duration: 0, thumbnail: null };
  });
}

// ---------------------------------------------------------------- Media Session (layar kunci, notifikasi, tombol media)
function updateMediaSession(s: Song, line: string | null = null) {
  if (!('mediaSession' in navigator)) return;
  const a = art(s, true);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: s.title, artist: line || s.artist, album: s.album || 'Freease',
    artwork: a ? [{ src: a, sizes: '512x512' }] : [{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' }],
  });
}
/** Lirik di notifikasi & layar kunci: baris yang sedang dinyanyikan menggantikan nama artis (null = kembalikan). */
export function setMediaLine(line: string | null) {
  const s = currentSong();
  if (s) updateMediaSession(s, line);
}
function updatePositionState() {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  const d = get().duration;
  if (!d || !isFinite(d)) return;
  try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(position(), d), playbackRate: get().speed }); } catch { /* abaikan */ }
}
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const h = (a: MediaSessionAction, fn: MediaSessionActionHandler) => { try { ms.setActionHandler(a, fn); } catch { /* tidak didukung */ } };
  h('play', () => resume());
  h('pause', () => pause());
  h('nexttrack', () => next());
  h('previoustrack', () => prev());
  h('seekto', (d) => d.seekTime != null && seek(d.seekTime));
  h('seekforward', (d) => seek(position() + (d.seekOffset || 10)));
  h('seekbackward', (d) => seek(position() - (d.seekOffset || 10)));
  usePlayer.subscribe((s) => { ms.playbackState = s.playing ? 'playing' : s.index >= 0 ? 'paused' : 'none'; });
}

// ---------------------------------------------------------------- simpan antrean (lanjut saat dibuka lagi)
usePlayer.subscribe((s, p) => {
  if (s.queue !== p.queue || s.index !== p.index) {
    try {
      const q = s.queue.filter((x) => !isLocalFile(x.id)).slice(0, 300);
      const cur = s.queue[s.index];
      localStorage.setItem('freease-queue', JSON.stringify({ queue: q, index: cur ? q.findIndex((x) => x.id === cur.id) : -1, from: s.from }));
    } catch { /* penuh */ }
  }
});
window.addEventListener('pagehide', () => {
  flushListening();
  try { localStorage.setItem('freease-pos', String(position())); } catch { /* abaikan */ }
});
export function restoreQueue() {
  try {
    const saved = JSON.parse(localStorage.getItem('freease-queue') || 'null');
    if (saved?.queue?.length && saved.index >= 0) {
      set({ queue: saved.queue, index: saved.index, from: saved.from || '' });
      const pos = Number(localStorage.getItem('freease-pos') || 0);
      loadCurrent(false).then(() => { if (pos > 0) setTimeout(() => seek(pos), 300); });
    }
  } catch { /* abaikan */ }
}

// ---------------------------------------------------------------- unduh untuk offline
export async function download(song: Song): Promise<boolean> {
  if (isLocalFile(song.id)) return false;
  try {
    const r = await fetch(api.streamUrl(song.id));
    if (!r.ok) throw new Error(r.status === 503 ? 'Server diblokir YouTube' : `Gagal (${r.status})`);
    const blob = await r.blob();
    await db.saveDownload(song, blob);
    api.lyrics(song).then((l) => db.saveLyrics(song.id, l)).catch(() => {});
    return true;
  } catch (e) {
    toast(`Gagal mengunduh "${song.title}": ${(e as Error).message}`);
    return false;
  }
}
