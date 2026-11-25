// Koleksi Freease Stream di browser (IndexedDB terpisah dari musik): favorit anime & komik, posisi tonton per
// episode, bab terakhir yang dibaca. Tidak ada yang dikirim ke server.
import { openDB, type IDBPDatabase } from 'idb';
import { useEffect, useState } from 'react';

export type Kind = 'anime' | 'manga';
export interface Fav { key: string; kind: Kind; id: string; title: string; cover: string | null; sub?: string | null; addedAt: number }
/** Satu entri per judul: episode/bab terakhir + posisi. */
export interface Progress {
  key: string; kind: Kind; id: string; title: string; cover: string | null;
  itemId: string; itemLabel: string; pos: number; dur: number; page?: number; pages?: number; updatedAt: number;
}
/** Episode/bab yang pernah dibuka (penanda "sudah ditonton/dibaca"). */
export interface Seen { key: string; parent: string; pos: number; dur: number; at: number }

let dbp: Promise<IDBPDatabase<any>> | null = null;
function db() {
  dbp ??= openDB<any>('freease-stream', 1, {
    upgrade(d) {
      d.createObjectStore('favs', { keyPath: 'key' });
      d.createObjectStore('progress', { keyPath: 'key' });
      const s = d.createObjectStore('seen', { keyPath: 'key' });
      s.createIndex('parent', 'parent');
    },
  });
  return dbp;
}

const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

/** Seperti useLibrary di musik: muat ulang tiap koleksi Stream berubah. */
export function useStore<T>(load: () => Promise<T>, initial: T, deps: unknown[] = []): T {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    let alive = true;
    const run = () => load().then((x) => alive && setV(x)).catch(() => {});
    run();
    listeners.add(run);
    return () => { alive = false; listeners.delete(run); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return v;
}

const k = (kind: Kind, id: string) => `${kind}:${id}`;

export async function isFav(kind: Kind, id: string) { return !!(await (await db()).get('favs', k(kind, id))); }
export async function setFav(f: Omit<Fav, 'key' | 'addedAt'>, on: boolean) {
  const d = await db();
  if (on) await d.put('favs', { ...f, key: k(f.kind, f.id), addedAt: Date.now() });
  else await d.delete('favs', k(f.kind, f.id));
  changed();
}
export async function favs(kind?: Kind): Promise<Fav[]> {
  const all: Fav[] = await (await db()).getAll('favs');
  return all.filter((f) => !kind || f.kind === kind).sort((a, b) => b.addedAt - a.addedAt);
}

export async function saveProgress(p: Omit<Progress, 'key' | 'updatedAt'>) {
  const d = await db();
  await d.put('progress', { ...p, key: k(p.kind, p.id), updatedAt: Date.now() });
  await d.put('seen', { key: k(p.kind, p.itemId), parent: k(p.kind, p.id), pos: p.pos, dur: p.dur, at: Date.now() });
  changed();
}
export async function progressOf(kind: Kind, id: string): Promise<Progress | undefined> { return (await db()).get('progress', k(kind, id)); }
export async function recent(kind?: Kind, limit = 30): Promise<Progress[]> {
  const all: Progress[] = await (await db()).getAll('progress');
  return all.filter((p) => !kind || p.kind === kind).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}
export async function forget(kind: Kind, id: string) {
  const d = await db();
  await d.delete('progress', k(kind, id));
  const seen = await d.getAllKeysFromIndex('seen', 'parent', k(kind, id));
  for (const s of seen) await d.delete('seen', s);
  changed();
}
export async function seenOf(kind: Kind, parentId: string): Promise<Map<string, Seen>> {
  const rows: Seen[] = await (await db()).getAllFromIndex('seen', 'parent', k(kind, parentId));
  return new Map(rows.map((r) => [r.key.slice(kind.length + 1), r]));
}
export async function seenItem(kind: Kind, itemId: string): Promise<Seen | undefined> { return (await db()).get('seen', k(kind, itemId)); }

export async function clearAll() {
  const d = await db();
  await Promise.all(['favs', 'progress', 'seen'].map((s) => d.clear(s)));
  changed();
}

/** Cadangan JSON untuk dipindah ke browser/HP lain. */
export async function exportStream(): Promise<string> {
  const d = await db();
  return JSON.stringify({ format: 'freease-stream-backup', version: 1, exportedAt: Date.now(), favs: await d.getAll('favs'), progress: await d.getAll('progress'), seen: await d.getAll('seen') });
}
export async function importStream(text: string) {
  let o: any;
  try { o = JSON.parse(text); } catch { throw new Error('Berkas bukan cadangan Freease Stream'); }
  if (o?.format !== 'freease-stream-backup') throw new Error('Berkas bukan cadangan Freease Stream');
  const d = await db();
  let n = 0;
  for (const store of ['favs', 'progress', 'seen'] as const) {
    for (const row of o[store] ?? []) {
      if (!row?.key) continue;
      const old = await d.get(store, row.key);
      if (!old || (row.updatedAt ?? row.at ?? row.addedAt ?? 0) > (old.updatedAt ?? old.at ?? old.addedAt ?? 0)) { await d.put(store, row); n++; }
    }
  }
  changed();
  return n;
}
