// Klien API Freease Stream (/api/fs): anime, episode, manga/manhwa/manhua.
import { ApiError } from '../lib/api';

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(path, { signal, credentials: 'same-origin' });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new ApiError(body.error || `Gagal (${r.status})`, r.status);
  }
  return r.json();
}
const q = encodeURIComponent;

export interface Anime {
  id: string; title: string; cover: string | null; banner: string | null; synopsis: string | null; type: string | null;
  status: string | null; year: number | null; rating: number | null; studio: string | null; views: number | null; genres: string[];
  /** Nama sumber (Animekompi, Otakudesu). */
  source?: string;
}
/** Anime dari daftar rilis sumber lain: nomor episode terakhir & tanggal rilisnya. */
export interface ReleaseItem extends Anime { episode: string; date: string | null; day: string | null }
export interface LatestEpisode extends Anime { episode: string; episodeId: string; at: string | null }
export interface EpisodeRef { id: string; number: string; title: string; at?: string | null; views?: number | null }
export interface AnimeDetail extends Anime { altTitles: string | null; episodes: EpisodeRef[]; batch: { label: string; url: string; resolution: string | null }[] }
/** `mp4` diputar pemutar Freease sendiri; `embed` = pemutar situs lain di iframe ber-sandbox (cadangan). */
export interface VideoSource { label: string; quality: string; type: 'mp4' | 'embed'; url: string; fallback?: string }
export interface EpisodeData {
  id: string; number: string; title: string; anime: Anime | null;
  prev: { id: string; number: string } | null; next: { id: string; number: string } | null;
  sources: VideoSource[]; unsupported: number; downloads: { label: string; resolution: string | null; url: string }[]; episodes: EpisodeRef[];
}
export interface AnimeHome {
  featured: Anime[]; latest: LatestEpisode[]; trending: Anime[]; weekly: Anime[]; monthly: Anime[]; allTime: Anime[]; ongoing: Anime[]; completed: Anime[]; movies: Anime[];
  od?: { latest: ReleaseItem[]; completed: ReleaseItem[] };
}
/** Beranda Donghua: `latest` = episode baru (episodeId terisi). */
export interface DonghuaHome {
  latest: (ReleaseItem & { episodeId: string | null })[]; recommended: Anime[]; popular: Anime[]; ongoing: Anime[]; completed: Anime[]; animekompi: Anime[];
}
export interface ScheduleDay { day: string; items: { id: string; title: string; cover: string | null; episode: string; time: string | null; source?: string }[] }

export interface Manga { id: string; title: string; cover: string | null; type?: string | null; latest?: string | null; source: string; lang: 'id' | 'en'; author?: string | null; altTitles?: string[] }
export interface Chapter { id: string; number: string | null; title: string | null; at: number | null }
export interface MangaDetail extends Manga { description: string; genres: string[]; status: string | null; chapters: Chapter[]; partial?: boolean }
export interface MangaHome { popular: Manga[]; komikuPopular: Manga[]; latest: Manga[]; manhwa: Manga[]; webtoons: Manga[]; english: Manga[] }
export interface MangaSource { key: string; name: string; lang: 'id' | 'en' }

export const fs = {
  animeHome: (s?: AbortSignal) => get<AnimeHome>('/api/fs/anime/home', s),
  donghuaHome: (s?: AbortSignal) => get<DonghuaHome>('/api/fs/donghua/home', s),
  browse: (p: { order?: string; page?: number; genre?: string; type?: string; status?: string; source?: string }, s?: AbortSignal) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) if (v) u.set(k, String(v));
    return get<{ items: Anime[]; page: number; totalPages: number; total: number | null }>(`/api/fs/anime/browse?${u}`, s);
  },
  latest: (page = 1, s?: AbortSignal) => get<{ items: LatestEpisode[]; totalPages: number }>(`/api/fs/anime/latest?page=${page}`, s),
  genres: (source?: string, s?: AbortSignal) => get<{ id: string; name: string; count: number | null }[]>(`/api/fs/anime/genres${source ? `?source=${q(source)}` : ''}`, s),
  animeAlternatives: (a: { id: string; title: string; altTitles?: string | null }, s?: AbortSignal) =>
    get<Anime[]>(`/api/fs/anime/alternatives?id=${q(a.id)}&title=${q(a.title)}${a.altTitles ? `&alt=${q(a.altTitles.split(/[,;]/)[0].trim())}` : ''}`, s),
  schedule: (kind?: 'donghua', s?: AbortSignal) => get<ScheduleDay[]>(`/api/fs/anime/schedule${kind ? `?kind=${kind}` : ''}`, s),
  anime: (id: string, s?: AbortSignal) => get<AnimeDetail>(`/api/fs/anime/${q(id)}`, s),
  episode: (id: string, s?: AbortSignal) => get<EpisodeData>(`/api/fs/episode/${q(id)}`, s),
  search: (term: string, s?: AbortSignal) => get<{ anime: Anime[]; manga: Manga[] }>(`/api/fs/search?q=${q(term)}`, s),
  animeSearch: (term: string, s?: AbortSignal) => get<Anime[]>(`/api/fs/anime/search?q=${q(term)}`, s),

  mangaHome: (s?: AbortSignal) => get<MangaHome>('/api/fs/manga/home', s),
  mangaSources: (s?: AbortSignal) => get<MangaSource[]>('/api/fs/manga/sources', s),
  mangaBrowse: (source: string, p: { order?: string; page?: number; type?: string }, s?: AbortSignal) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) if (v) u.set(k, String(v));
    return get<Manga[]>(`/api/fs/manga/browse/${q(source)}?${u}`, s);
  },
  mangaSearch: (term: string, lang?: 'id' | 'en', s?: AbortSignal) => get<Manga[]>(`/api/fs/manga/search?q=${q(term)}${lang ? `&lang=${lang}` : ''}`, s),
  manga: (id: string, s?: AbortSignal) => get<MangaDetail>(`/api/fs/manga/detail?id=${q(id)}`, s),
  pages: (id: string, s?: AbortSignal) => get<string[]>(`/api/fs/manga/pages?id=${q(id)}`, s),
  alternatives: (m: { id: string; title: string; altTitles?: string[] }, s?: AbortSignal) =>
    get<Manga[]>(`/api/fs/manga/alternatives?id=${q(m.id)}&title=${q(m.title)}${(m.altTitles ?? []).slice(0, 3).map((a) => `&alt=${q(a)}`).join('')}`, s),
};

/** Rute halaman (id komik memuat ':' dan '/', jadi dikodekan). */
export const routes = {
  anime: (id: string) => `/stream/anime/${q(id)}`,
  watch: (id: string) => `/stream/watch/${q(id)}`,
  manga: (id: string) => `/stream/manga/${q(id)}`,
  read: (mangaId: string, chapterId: string) => `/stream/read/${q(mangaId)}/${q(chapterId)}`,
};

export function fmtClock(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60), m = Math.floor(sec / 60) % 60, h = Math.floor(sec / 3600);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function ago(t: number | string | null | undefined): string {
  const ms = typeof t === 'string' ? Date.parse(t.replace(' ', 'T')) : t ?? NaN;
  if (!isFinite(ms)) return '';
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return 'baru saja';
  if (d < 3600) return `${Math.floor(d / 60)} mnt lalu`;
  if (d < 86400) return `${Math.floor(d / 3600)} jam lalu`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)} hari lalu`;
  return new Date(ms).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}
