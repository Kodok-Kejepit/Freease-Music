// Lirik: ambil (memori → simpanan offline → server) dan urai LRC. Dipakai tampilan lirik, lirik melayang,
// dan lirik di notifikasi.
import { create } from 'zustand';
import { api } from './api';
import * as db from './db';
import type { Song } from './types';

export interface LrcLine { t: number; text: string }
export type LyricsData = { synced: string | null; plain: string | null; source: string | null; durationDiff?: number };

/** "[01:23.45] teks" → baris berwaktu (detik). Baris kosong dibuang. */
export function parseLrc(lrc: string): LrcLine[] {
  const out: LrcLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!tags.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of tags) out.push({ t: Number(m[1]) * 60 + Number(m[2]), text });
  }
  return out.sort((a, b) => a.t - b.t).filter((l, i, a) => l.text || (a[i + 1] && a[i + 1].t - l.t > 4));
}

/** Indeks baris yang sedang dinyanyikan pada detik `pos` (−1 = belum mulai). */
export function lineAt(lines: LrcLine[], pos: number): number {
  let a = -1;
  for (let i = 0; i < lines.length; i++) if (lines[i].t <= pos + 0.25) a = i; else break;
  return a;
}

const memory = new Map<string, LyricsData>();
const MATCHER_V2 = Date.UTC(2026, 9, 29);

export function cachedLyrics(id: string): LyricsData | undefined {
  return memory.get(id);
}

export async function loadLyrics(song: Song): Promise<LyricsData | null> {
  if (song.id.startsWith('file:')) return null;
  const hit = memory.get(song.id);
  if (hit) return hit;
  const saved = await db.cachedLyrics(song.id).catch(() => undefined);
  const usable = saved && (saved.synced || saved.plain);
  // Simpanan dari sebelum pencocokan lirik diperbaiki (1.3) diambil ulang sekali; kalau gagal tetap dipakai.
  if (usable && saved.savedAt >= MATCHER_V2) {
    memory.set(song.id, saved);
    return saved;
  }
  let l: LyricsData;
  try {
    l = await api.lyrics(song);
  } catch (e) {
    if (usable) { memory.set(song.id, saved); return saved; }
    throw e;
  }
  memory.set(song.id, l);
  if (l.synced || l.plain) db.saveLyrics(song.id, l).catch(() => {});
  return l;
}

// ---------------------------------------------------------------- geser waktu lirik (per lagu, di browser ini)
const OFFSET_KEY = 'freease-lyrics-offset';
function readOffsets(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(OFFSET_KEY) || '{}'); } catch { return {}; }
}
/** Detik: positif = lirik muncul lebih lambat (untuk video klip yang punya intro). */
export const useLyricsOffset = create<{ map: Record<string, number> }>(() => ({ map: readOffsets() }));
export const lyricsOffset = (id: string) => useLyricsOffset.getState().map[id] ?? 0;
export function setLyricsOffset(id: string, sec: number) {
  const map = { ...useLyricsOffset.getState().map };
  const v = Math.round(sec * 10) / 10;
  if (v) map[id] = v; else delete map[id];
  const keys = Object.keys(map);
  if (keys.length > 500) delete map[keys[0]];
  useLyricsOffset.setState({ map });
  try { localStorage.setItem(OFFSET_KEY, JSON.stringify(map)); } catch { /* penuh */ }
}
