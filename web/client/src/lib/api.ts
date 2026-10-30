import type { ArtistItem, PlaylistItem, Song } from './types';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly blocked = false) {
    super(message);
  }
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(path, { signal, credentials: 'same-origin' });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new ApiError(body.error || `Gagal (${r.status})`, r.status, !!body.blocked);
  }
  return r.json();
}

const q = (s: string) => encodeURIComponent(s);

/** Browser bisa memutar opus (hampir semua; iPhone lama tidak) → kalau tidak, minta AAC dari server. */
const OPUS = typeof document !== 'undefined' && document.createElement('audio').canPlayType('audio/webm; codecs="opus"') !== '';

export interface Cue { s: number; e: number; t: string }
export interface VideoInfo {
  description: string;
  likes: number | null;
  subscribers: number | null;
  uploadDate: string | null;
  chapters: { start: number; title: string }[];
  captions: { lang: string; name: string; kind: 'manual' | 'asr' }[];
}

export const api = {
  config: () => get<{ needsPassword: boolean; authed: boolean; voice: string[]; version: string }>('/api/config'),
  login: async (password: string) => {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
    if (!r.ok) throw new ApiError((await r.json().catch(() => ({}))).error || 'Gagal masuk', r.status);
  },
  searchSongs: (s: string, videos = false, signal?: AbortSignal) =>
    get<{ songs: Song[] }>(`/api/search?q=${q(s)}&type=${videos ? 'videos' : 'songs'}`, signal).then((r) => r.songs ?? []),
  searchArtists: (s: string, signal?: AbortSignal) => get<{ artists: ArtistItem[] }>(`/api/search?q=${q(s)}&type=artists`, signal).then((r) => r.artists ?? []),
  searchPlaylists: (s: string, albums = false, signal?: AbortSignal) =>
    get<{ playlists: PlaylistItem[] }>(`/api/search?q=${q(s)}&type=${albums ? 'albums' : 'playlists'}`, signal).then((r) => r.playlists ?? []),
  /** Satu halaman hasil pencarian + token halaman berikutnya (null = habis). */
  searchPage: async <T = unknown>(s: string, type: string, signal?: AbortSignal): Promise<{ items: T[]; next: string | null }> => {
    const r = await get<Record<string, unknown>>(`/api/search?q=${q(s)}&type=${type}`, signal);
    const key = type === 'artists' ? 'artists' : type === 'playlists' || type === 'albums' ? 'playlists' : 'songs';
    return { items: (r[key] as T[]) ?? [], next: (r.next as string) ?? null };
  },
  searchMore: <T = unknown>(next: string, signal?: AbortSignal) => get<{ items: T[]; next: string | null }>(`/api/search?next=${q(next)}`, signal),
  suggest: (s: string, signal?: AbortSignal, src: 'music' | 'youtube' = 'music') => get<string[]>(`/api/suggest?q=${q(s)}&src=${src}`, signal),
  song: (id: string) => get<Song>(`/api/song/${q(id)}`),
  related: (id: string, youtube = false) => get<Song[]>(`/api/related/${q(id)}${youtube ? '?src=youtube' : ''}`),
  artist: (id: string) => get<{ id: string; name: string; thumbnail?: string; description?: string; songs: Song[]; releases: PlaylistItem[] }>(`/api/artist/${q(id)}`),
  playlist: (id: string) => get<{ id: string; title: string; subtitle?: string; thumbnail?: string; songs: Song[] }>(`/api/playlist/${q(id)}`),
  lyrics: (s: Song) =>
    get<{ synced: string | null; plain: string | null; source: string | null; durationDiff?: number }>(
      `/api/lyrics?id=${q(s.id)}&title=${q(s.title)}&artist=${q(s.artist)}&duration=${Math.round(s.duration || 0)}`,
    ),
  videoInfo: (id: string, signal?: AbortSignal) => get<VideoInfo>(`/api/videoinfo/${q(id)}`, signal),
  captions: (id: string, lang: string, signal?: AbortSignal) => get<{ lang: string; name: string; translated: boolean; cues: Cue[] }>(`/api/captions/${q(id)}?lang=${q(lang)}`, signal),
  translate: async (lines: string[], to = 'id'): Promise<string[]> => {
    const r = await fetch('/api/translate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lines, to }) });
    if (!r.ok) throw new ApiError((await r.json().catch(() => ({}))).error || 'Terjemahan gagal', r.status);
    return (await r.json()).lines;
  },
  playable: (id: string) => get<{ ok: boolean; blocked?: boolean; error?: string }>(`/api/playable/${q(id)}`),
  status: () => get<{ ytdlp: boolean | null; cookies: boolean; potProvider: boolean; cached: number; engine: string | null; memoryMb: number }>('/api/status'),
  diagnose: () => get<{ ok: boolean; engine: string | null; ms: number; blocked: boolean; message: string }>('/api/diagnose'),
  streamUrl: (id: string, low = false) => {
    const p = [low && 'q=low', !OPUS && 'f=m4a'].filter(Boolean).join('&');
    return `/api/stream/${q(id)}${p ? `?${p}` : ''}`;
  },
  videoUrl: (id: string, height: number, codecs: string[]) => `/api/video/${q(id)}?h=${height}&c=${codecs.join(',')}`,
  formats: (id: string, codecs: string[]) => get<{ heights: number[] }>(`/api/formats/${q(id)}?c=${codecs.join(',')}`),
};

/** Thumbnail YouTube ukuran lebih kecil/besar (hemat data di daftar, tajam di pemutar). */
export function art(s: { id: string; thumbnail?: string | null }, big = false): string | undefined {
  const t = s.thumbnail || undefined;
  if (t && /googleusercontent|ggpht/.test(t)) return t.replace(/=w\d+-h\d+.*$|=s\d+.*$/, big ? '=w800-h800-l90-rj' : '=w226-h226-l90-rj');
  if (!s.id.startsWith('file:') && /^[A-Za-z0-9_-]{11}$/.test(s.id)) return `https://i.ytimg.com/vi/${s.id}/${big ? 'hq720' : 'mqdefault'}.jpg`;
  return t;
}

export function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
