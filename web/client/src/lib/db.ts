// Koleksi pribadi di browser (IndexedDB): lagu disukai, playlist, riwayat putar, unduhan offline.
import { openDB, type IDBPDatabase } from 'idb';
import type { LocalPlaylist, PlayEvent, Song } from './types';

interface Schema {
  liked: { key: string; value: Song & { likedAt: number } };
  playlists: { key: string; value: LocalPlaylist };
  history: { key: number; value: PlayEvent; indexes: { songId: string; timestamp: number } };
  songs: { key: string; value: Song & { lastPlayedAt?: number } };
  downloads: { key: string; value: { id: string; song: Song; blob: Blob; mime: string; savedAt: number } };
  lyrics: { key: string; value: { id: string; synced: string | null; plain: string | null; source: string | null; savedAt: number } };
  artists: { key: string; value: { id: string; name: string; thumbnail?: string | null } };
}

const DB_NAME = 'freease';
let dbp: Promise<IDBPDatabase<any>> | null = null;

export function db() {
  dbp ??= openDB<any>(DB_NAME, 1, {
    upgrade(d) {
      d.createObjectStore('liked', { keyPath: 'id' });
      d.createObjectStore('playlists', { keyPath: 'id' });
      const h = d.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
      h.createIndex('songId', 'songId');
      h.createIndex('timestamp', 'timestamp');
      d.createObjectStore('songs', { keyPath: 'id' });
      d.createObjectStore('downloads', { keyPath: 'id' });
      d.createObjectStore('lyrics', { keyPath: 'id' });
      d.createObjectStore('artists', { keyPath: 'id' });
    },
  });
  return dbp as Promise<IDBPDatabase<any>>;
}
export type { Schema };

// ---------------------------------------------------------------- pemberitahuan perubahan
type Listener = () => void;
const listeners = new Set<Listener>();
export function onLibraryChange(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function changed() {
  listeners.forEach((f) => f());
}
export const notifyChanged = changed;

const strip = (s: Song): Song => ({
  id: s.id, title: s.title, artist: s.artist, artistId: s.artistId ?? null, album: s.album ?? null, duration: s.duration || 0, thumbnail: s.thumbnail ?? null,
});

// ---------------------------------------------------------------- disukai
export async function isLiked(id: string) {
  return !!(await (await db()).get('liked', id));
}
export async function setLiked(s: Song, liked: boolean) {
  const d = await db();
  if (liked) await d.put('liked', { ...strip(s), likedAt: Date.now() });
  else await d.delete('liked', s.id);
  changed();
}
export async function likedSongs(): Promise<(Song & { likedAt: number })[]> {
  const all = await (await db()).getAll('liked');
  return all.sort((a, b) => b.likedAt - a.likedAt);
}

// ---------------------------------------------------------------- playlist
export async function playlists(): Promise<LocalPlaylist[]> {
  const all: LocalPlaylist[] = await (await db()).getAll('playlists');
  return all.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
}
export async function getPlaylist(id: string): Promise<LocalPlaylist | undefined> {
  return (await db()).get('playlists', id);
}
export async function savePlaylist(p: LocalPlaylist) {
  await (await db()).put('playlists', { ...p, songs: p.songs.map(strip), updatedAt: Date.now() });
  changed();
}
export async function createPlaylist(name: string, songs: Song[] = []): Promise<LocalPlaylist> {
  const p: LocalPlaylist = {
    id: crypto.randomUUID(), name: name.trim() || 'Playlist', description: '', folder: '', pinned: false,
    songs: songs.map(strip), createdAt: Date.now(), updatedAt: Date.now(),
  };
  await savePlaylist(p);
  return p;
}
export async function deletePlaylist(id: string) {
  await (await db()).delete('playlists', id);
  changed();
}
export async function addToPlaylist(id: string, songs: Song[]) {
  const p = await getPlaylist(id);
  if (!p) return 0;
  const have = new Set(p.songs.map((s) => s.id));
  const add = songs.filter((s) => !have.has(s.id));
  p.songs.push(...add.map(strip));
  await savePlaylist(p);
  return add.length;
}

// ---------------------------------------------------------------- riwayat & statistik
export async function recordPlay(s: Song, playedMs: number) {
  const d = await db();
  const now = Date.now();
  await d.put('songs', { ...strip(s), lastPlayedAt: now });
  await d.add('history', { songId: s.id, timestamp: now, playedMs });
  changed();
}
export async function touchSong(s: Song) {
  const d = await db();
  const prev = await d.get('songs', s.id);
  await d.put('songs', { ...strip(s), lastPlayedAt: Date.now(), ...(prev ? {} : {}) });
}
export async function songMeta(id: string): Promise<Song | undefined> {
  return (await db()).get('songs', id);
}
export async function historySince(since: number): Promise<PlayEvent[]> {
  return (await db()).getAllFromIndex('history', 'timestamp', IDBKeyRange.lowerBound(since));
}
export async function recentSongs(limit = 30): Promise<Song[]> {
  const all: (Song & { lastPlayedAt?: number })[] = await (await db()).getAll('songs');
  return all.filter((s) => s.lastPlayedAt).sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0)).slice(0, limit);
}
/** Hapus riwayat putar: catatan putar + tanda "baru diputar" di setiap lagu (daftar Beranda ikut kosong). */
export async function clearHistory() {
  const d = await db();
  await d.clear('history');
  const tx = d.transaction('songs', 'readwrite');
  for (let c = await tx.store.openCursor(); c; c = await c.continue()) {
    const v = c.value as Song & { lastPlayedAt?: number };
    if (v.lastPlayedAt) { delete v.lastPlayedAt; await c.update(v); }
  }
  await tx.done;
  changed();
}

/** Hapus satu lagu/video dari riwayat (semua catatan putarnya + daftar "baru diputar"). */
export async function forgetSong(id: string) {
  const d = await db();
  const tx = d.transaction(['history', 'songs'], 'readwrite');
  for (const key of await tx.objectStore('history').index('songId').getAllKeys(id)) await tx.objectStore('history').delete(key);
  const v = (await tx.objectStore('songs').get(id)) as (Song & { lastPlayedAt?: number }) | undefined;
  if (v?.lastPlayedAt) { delete v.lastPlayedAt; await tx.objectStore('songs').put(v); }
  await tx.done;
  changed();
}

/** Hapus lirik yang tersimpan untuk dibaca offline. */
export async function clearLyrics() {
  await (await db()).clear('lyrics');
}

/** Hapus SEMUA data Freease di browser ini (koleksi, playlist, unduhan, riwayat, pengaturan). */
export async function wipeEverything() {
  (await db()).close();
  dbp = null;
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
  for (const k of Object.keys(localStorage)) if (k.startsWith('freease')) localStorage.removeItem(k);
  if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k);
}

/** Lagu & artis teratas dalam rentang waktu (untuk Statistik, Beranda, dan asisten). */
export async function topStats(since: number) {
  const events = await historySince(since);
  const d = await db();
  const bySong = new Map<string, { ms: number; plays: number }>();
  for (const e of events) {
    const v = bySong.get(e.songId) || { ms: 0, plays: 0 };
    v.ms += e.playedMs; v.plays++;
    bySong.set(e.songId, v);
  }
  const songs: { song: Song; ms: number; plays: number }[] = [];
  for (const [id, v] of bySong) {
    const s = await d.get('songs', id);
    if (s) songs.push({ song: s, ...v });
  }
  songs.sort((a, b) => b.ms - a.ms);
  const byArtist = new Map<string, { artist: string; artistId?: string | null; ms: number; plays: number; sample: Song }>();
  for (const s of songs) {
    const key = s.song.artist.toLowerCase();
    const v = byArtist.get(key) || { artist: s.song.artist, artistId: s.song.artistId, ms: 0, plays: 0, sample: s.song };
    v.ms += s.ms; v.plays += s.plays;
    byArtist.set(key, v);
  }
  const artists = [...byArtist.values()].sort((a, b) => b.ms - a.ms);
  const totalMs = events.reduce((a, e) => a + e.playedMs, 0);
  return { events, songs, artists, totalMs };
}

// ---------------------------------------------------------------- unduhan offline
export async function saveDownload(song: Song, blob: Blob) {
  await (await db()).put('downloads', { id: song.id, song: strip(song), blob, mime: blob.type, savedAt: Date.now() });
  changed();
}
export async function getDownload(id: string) {
  return (await db()).get('downloads', id) as Promise<{ id: string; song: Song; blob: Blob; mime: string; savedAt: number } | undefined>;
}
export async function downloads() {
  const all = await (await db()).getAll('downloads');
  return (all as { id: string; song: Song; blob: Blob; savedAt: number }[]).sort((a, b) => b.savedAt - a.savedAt);
}
export async function downloadIds(): Promise<Set<string>> {
  return new Set((await (await db()).getAllKeys('downloads')) as string[]);
}
export async function deleteDownload(id: string) {
  await (await db()).delete('downloads', id);
  changed();
}

// ---------------------------------------------------------------- lirik tersimpan
export async function cachedLyrics(id: string) {
  return (await db()).get('lyrics', id);
}
export async function saveLyrics(id: string, l: { synced: string | null; plain: string | null; source: string | null }) {
  await (await db()).put('lyrics', { id, ...l, savedAt: Date.now() });
}

/** Terjemahan lirik per lagu (disimpan di browser supaya tidak diterjemahkan ulang). */
export async function lyricsTranslation(id: string): Promise<string[] | undefined> {
  return (await (await db()).get('lyrics', `tr:${id}`))?.lines;
}
export async function saveLyricsTranslation(id: string, lines: string[]) {
  await (await db()).put('lyrics', { id: `tr:${id}`, lines, savedAt: Date.now() });
}

// ---------------------------------------------------------------- artis diikuti
export async function followedArtists() {
  return (await db()).getAll('artists') as Promise<{ id: string; name: string; thumbnail?: string | null }[]>;
}
export async function setFollow(a: { id: string; name: string; thumbnail?: string | null }, follow: boolean) {
  const d = await db();
  if (follow) await d.put('artists', a);
  else await d.delete('artists', a.id);
  changed();
}
export async function isFollowing(id: string) {
  return !!(await (await db()).get('artists', id));
}
