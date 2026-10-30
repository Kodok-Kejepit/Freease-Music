// Cadangan berformat sama dengan app Android ("freease-backup" v2): bisa dipindah HP ⇄ web.
import * as db from './db';
import type { Song } from './types';

const channelId = (url?: string | null) => url?.match(/(UC[A-Za-z0-9_-]{20,})/)?.[1] ?? null;
const channelUrl = (id?: string | null) => (id ? `https://www.youtube.com/channel/${id}` : null);

const toJson = (s: Song) => ({
  id: s.id, title: s.title, artist: s.artist, artistUrl: channelUrl(s.artistId), album: s.album ?? null, durationSec: s.duration || 0, thumbnail: s.thumbnail ?? null,
});
const fromJson = (o: any): Song | null =>
  o?.id ? { id: String(o.id), title: String(o.title ?? ''), artist: String(o.artist ?? ''), artistId: channelId(o.artistUrl), album: o.album ?? null, duration: Number(o.durationSec) || 0, thumbnail: o.thumbnail ?? null } : null;

export async function exportBackup(): Promise<string> {
  const liked = await db.likedSongs();
  const lists = await db.playlists();
  const artists = await db.followedArtists();
  const events = await db.historySince(0);
  const ids = [...new Set(events.map((e) => e.songId))];
  const historySongs: Song[] = [];
  for (const id of ids) { const s = await db.songMeta(id); if (s) historySongs.push(s); }
  return JSON.stringify({
    format: 'freease-backup', version: 2, exportedAt: Date.now(),
    liked: liked.map(toJson),
    playlists: lists.map((p) => ({ name: p.name, description: p.description, pinned: p.pinned, folder: p.folder, songs: p.songs.map(toJson) })),
    artists: artists.map((a) => ({ url: channelUrl(a.id), name: a.name, thumbnail: a.thumbnail ?? null })),
    historySongs: historySongs.map(toJson),
    history: events.map((e) => [e.songId, e.timestamp, e.playedMs]),
  });
}

/** @returns ringkasan yang ditambahkan. Data yang sudah ada tidak digandakan. */
export async function importBackup(text: string) {
  let root: any;
  try { root = JSON.parse(text); } catch { throw new Error('Berkas bukan cadangan Freease'); }
  if (root?.format !== 'freease-backup') throw new Error('Berkas bukan cadangan Freease');
  if (!(root.version >= 1 && root.version <= 2)) throw new Error('Versi cadangan tidak didukung');
  const d = await db.db();
  let liked = 0, playlists = 0, plays = 0, artists = 0;
  for (const o of root.liked ?? []) {
    const s = fromJson(o);
    if (s && !(await d.get('liked', s.id))) { await d.put('liked', { ...s, likedAt: Date.now() - liked }); liked++; }
  }
  const existing = await db.playlists();
  for (const p of root.playlists ?? []) {
    const songs = (p.songs ?? []).map(fromJson).filter(Boolean) as Song[];
    const same = existing.find((e) => e.name === p.name);
    if (same) {
      const have = new Set(same.songs.map((s) => s.id));
      same.songs.push(...songs.filter((s) => !have.has(s.id)));
      await db.savePlaylist(same);
    } else {
      const n = await db.createPlaylist(p.name || 'Playlist', songs);
      await db.savePlaylist({ ...n, description: p.description || '', pinned: !!p.pinned, folder: p.folder || '' });
      playlists++;
    }
  }
  for (const a of root.artists ?? []) {
    const id = channelId(a.url);
    if (id && !(await db.isFollowing(id))) { await db.setFollow({ id, name: a.name, thumbnail: a.thumbnail }, true); artists++; }
  }
  for (const o of root.historySongs ?? []) {
    const s = fromJson(o);
    if (s && !(await d.get('songs', s.id))) await d.put('songs', s);
  }
  const keys = new Set((await db.historySince(0)).map((e) => `${e.songId}@${e.timestamp}`));
  const tx = d.transaction('history', 'readwrite');
  for (const h of root.history ?? []) {
    if (!Array.isArray(h) || keys.has(`${h[0]}@${h[1]}`)) continue;
    await tx.store.add({ songId: String(h[0]), timestamp: Number(h[1]), playedMs: Number(h[2]) || 0 });
    plays++;
  }
  await tx.done;
  // Waktu terakhir diputar per lagu, supaya "Baru diputar" ikut pulih.
  const last = new Map<string, number>();
  for (const h of root.history ?? []) if (Array.isArray(h)) last.set(String(h[0]), Math.max(last.get(String(h[0])) || 0, Number(h[1])));
  for (const [id, at] of last) { const s = await d.get('songs', id); if (s && (!s.lastPlayedAt || s.lastPlayedAt < at)) await d.put('songs', { ...s, lastPlayedAt: at }); }
  db.notifyChanged();
  return { liked, playlists, artists, plays };
}
