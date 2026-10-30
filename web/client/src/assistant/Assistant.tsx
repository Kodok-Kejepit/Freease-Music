import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, X } from 'lucide-react';
import { api } from '../lib/api';
import * as db from '../lib/db';
import { useSettings } from '../lib/settings';
import type { Song } from '../lib/types';
import * as P from '../player/player';
import { useUi } from '../components/uiState';
import { MOODS, PAGE_LABEL, parse, type Command, type MoodKind } from './parser';

const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
export const speechSupported = !!SR;

type Clip = 'greet' | 'ack' | 'play' | 'search' | 'intro' | 'fun' | 'thanks' | 'not_found';
interface Reply { text: string; clip: Clip; ok: boolean }

/** Ingatan singkat antar-perintah ("yang lain dong", "yang tadi lagi"). */
const memory = { query: null as string | null, mood: null as MoodKind | null, previous: null as Song | null, played: new Set<string>(), at: 0 };
const fresh = () => Date.now() - memory.at < 30 * 60_000;
function remember(query: string | null, mood: MoodKind | null, songs: Song[]) {
  const cur = P.currentSong();
  if (cur && !songs.some((s) => s.id === cur.id)) memory.previous = cur;
  memory.query = query; memory.mood = mood; memory.at = Date.now();
  songs.forEach((s) => memory.played.add(s.id));
}

async function queueFor(q: string): Promise<Song[]> {
  if (navigator.onLine) {
    try { const r = await api.searchSongs(q); if (r.length) return r; } catch { /* offline/ gagal */ }
  }
  const dls = (await db.downloads()).map((d) => d.song);
  const needle = q.toLowerCase();
  return dls.filter((s) => `${s.title} ${s.artist}`.toLowerCase().includes(needle));
}

export function useExecutor() {
  const nav = useNavigate();
  const ui = useUi();
  return useCallback(async (cmd: Command): Promise<Reply> => {
    const cur = P.currentSong();
    const ok = (text: string, clip: Clip = 'ack'): Reply => ({ text, clip, ok: true });
    const fail = (text: string): Reply => ({ text, clip: 'not_found', ok: false });
    const openPage = (path: string) => { ui.set({ nowPlaying: false }); nav(path); };
    switch (cmd.type) {
      case 'play': {
        const songs = await queueFor(cmd.query);
        if (!songs.length) return fail(`Sorry, "${cmd.query}" nggak ketemu.`);
        remember(cmd.query, null, songs.slice(0, 1));
        P.play(songs, 0, `Asisten: ${cmd.query}`);
        return ok(`Siap, gua puterin ${songs[0].title} dari ${songs[0].artist}.`, 'play');
      }
      case 'search': openPage(`/search?q=${encodeURIComponent(cmd.query)}`); return ok(`Nanti gua cariin "${cmd.query}".`, 'search');
      case 'playLiked': {
        const s = await db.likedSongs();
        if (!s.length) return fail('Belum ada lagu yang lu sukai.');
        P.play(s, 0, 'Lagu yang Disukai', true);
        return ok('Gua puterin lagu-lagu kesukaan lu, diacak.', 'play');
      }
      case 'playDownloads': {
        const s = (await db.downloads()).map((d) => d.song);
        if (!s.length) return fail('Belum ada lagu yang lu download.');
        P.play(s, 0, 'Unduhan', true);
        openPage('/downloads');
        return ok(`Gua puterin ${s.length} lagu yang udah lu download.`, 'play');
      }
      case 'playPlaylist':
      case 'openPlaylist': {
        const lists = await db.playlists();
        const p = lists.find((x) => x.name.toLowerCase() === cmd.name) || lists.find((x) => x.name.toLowerCase().includes(cmd.name));
        if (!p) return fail(`Sorry, playlist "${cmd.name}" nggak ketemu di koleksi lu.`);
        if (cmd.type === 'openPlaylist') { openPage(`/playlist/${p.id}`); return ok(`Nih playlist ${p.name}.`); }
        if (!p.songs.length) return fail(`Sorry, playlist ${p.name} masih kosong.`);
        P.play(p.songs, 0, p.name);
        return ok(`Gua puterin playlist ${p.name}.`, 'play');
      }
      case 'openArtist': {
        try {
          const a = (await api.searchArtists(cmd.name))[0];
          if (a) { openPage(`/artist/${a.id}`); return ok(`Nih halaman ${a.name}.`); }
        } catch { /* lanjut cari */ }
        openPage(`/search?q=${encodeURIComponent(cmd.name)}&t=artists`);
        return ok(`Gua cariin artis ${cmd.name}.`, 'search');
      }
      case 'open': {
        const paths: Record<string, string> = { home: '/', search: '/search', library: '/library', liked: '/liked', downloads: '/downloads', local: '/local', history: '/history', stats: '/stats', settings: '/settings', equalizer: '/settings', karaoke: '/settings' };
        if (cmd.page === 'player' || cmd.page === 'queue') {
          if (!cur) return fail('Belum ada lagu yang diputer.');
          ui.set({ nowPlaying: true, npTab: cmd.page === 'queue' ? 'queue' : null });
        } else openPage(paths[cmd.page]);
        return ok(`Oke, gua bukain ${PAGE_LABEL[cmd.page]}.`);
      }
      case 'back': if (ui.nowPlaying) ui.set({ nowPlaying: false }); else nav(-1); return ok('Oke, balik.');
      case 'next': if (!cur) return fail('Belum ada lagu yang diputer.'); P.next(); return ok('Lanjut lagu berikutnya.');
      case 'previous': if (!cur) return fail('Belum ada lagu yang diputer.'); P.prev(); return ok('Lagu sebelumnya.');
      case 'pause': P.pause(); return ok('Oke, gua jeda dulu.');
      case 'resume': if (!cur) return fail('Belum ada lagu yang diputer.'); P.resume(); return ok('Lanjut!');
      case 'like': if (!cur) return fail('Belum ada lagu yang diputer.'); await db.setLiked(cur, true); return ok(`${cur.title} udah gua masukin ke lagu kesukaan lu.`);
      case 'shuffle': { const on = cmd.on ?? !P.usePlayer.getState().shuffle; if (on !== P.usePlayer.getState().shuffle) P.toggleShuffle(); return ok(on ? 'Mode acak menyala.' : 'Mode acak dimatikan.'); }
      case 'repeat': P.usePlayer.setState({ repeat: 'one' }); return ok('Oke, lagu ini gua ulang terus.');
      case 'karaoke': P.setKaraoke(cmd.on); return ok(cmd.on ? 'Karaoke nyala, gas nyanyi!' : 'Mode Karaoke dimatikan.', cmd.on ? 'fun' : 'ack');
      case 'lyrics': if (!cur) return fail('Belum ada lagu yang diputer.'); ui.set({ nowPlaying: true, npTab: 'lyrics' }); return ok('Nih liriknya.');
      case 'sleep': P.setSleep(cmd.minutes); return ok(`Siap, musiknya gua matiin dalam ${cmd.minutes >= 60 && cmd.minutes % 60 === 0 ? `${cmd.minutes / 60} jam` : `${cmd.minutes} menit`}.`);
      case 'cancelSleep': P.setSleep(null); return ok('Timer tidur dibatalkan.');
      case 'whatsPlaying': return cur ? ok(`Ini ${cur.title} dari ${cur.artist}.`) : fail('Belum ada lagu yang diputer.');
      case 'volume': P.setVolume(P.usePlayer.getState().volume + (cmd.up ? 0.15 : -0.15)); return ok(cmd.up ? 'Volume dinaikkan.' : 'Volume diturunkan.');
      case 'help': return ok('Gua Freease, asisten pribadi lu. Bilang aja: putar Tulus, yang lain dong, lagu buat belajar, buka koleksi, lagu berikutnya, nyalain karaoke, atau timer tidur tiga puluh menit.', 'intro');
      case 'mood': return playMood(cmd.mood, false);
      case 'more': {
        if (fresh() && memory.mood) return playMood(memory.mood, true);
        if (fresh() && memory.query) {
          const songs = (await queueFor(memory.query)).filter((s) => !memory.played.has(s.id) && s.id !== cur?.id);
          if (!songs.length) return fail(`Sorry, yang lain buat "${memory.query}" nggak ketemu.`);
          remember(memory.query, null, songs.slice(0, 1));
          P.play(songs, 0, `Asisten: ${memory.query}`);
          return ok(`Oke, yang lain: ${songs[0].title} dari ${songs[0].artist}.`, 'play');
        }
        if (cur) {
          const more = await api.related(cur.id).catch(() => []);
          if (more.length) { remember(null, null, []); P.play(more, 0, `Mirip ${cur.title}`); return ok(`Oke, gua puterin lagu-lagu yang mirip ${cur.title}.`, 'play'); }
        }
        return fail('Belum ada lagu yang diputer. Coba bilang "putar" terus judul lagunya.');
      }
      case 'again': {
        const prev = memory.previous && memory.previous.id !== cur?.id ? memory.previous : null;
        if (prev) { remember(null, null, [prev]); P.play([prev], 0, 'Asisten'); return ok(`Siap, gua puterin lagi ${prev.title}.`, 'play'); }
        if (P.usePlayer.getState().index > 0) { P.prev(); return ok('Siap, balik ke lagu yang tadi.'); }
        return fail('Sorry, belum ada lagu sebelumnya, nggak ketemu yang tadi.');
      }
      case 'summary': {
        const since = cmd.days <= 1 ? new Date().setHours(0, 0, 0, 0) : Date.now() - cmd.days * 86400_000;
        const s = await db.topStats(since);
        const period = cmd.days === 1 ? 'Hari ini' : cmd.days === 7 ? 'Seminggu ini' : 'Sebulan ini';
        if (s.totalMs < 60_000) return ok(`${period} lu belum dengerin apa-apa. Yuk, putar sesuatu!`);
        const min = Math.round(s.totalMs / 60000);
        const time = min >= 60 ? `${Math.floor(min / 60)} jam${min % 60 ? ` ${min % 60} menit` : ''}` : `${min} menit`;
        let text = `${period} lu dengerin ${time}`;
        if (s.songs[0]) text += `, paling sering ${s.songs[0].song.title} (${s.songs[0].plays}×)`;
        if (s.artists[0]) text += `, artis favorit ${s.artists[0].artist}`;
        return ok(text + '.');
      }
    }
  }, [nav, ui]);
}

async function playMood(mood: MoodKind, more: boolean): Promise<Reply> {
  const m = MOODS[mood];
  let songs: Song[] = [];
  try { songs = await api.searchSongs(m.query); } catch { /* offline */ }
  if (more) songs = songs.filter((s) => !memory.played.has(s.id));
  if (!songs.length) songs = (await db.downloads()).map((d) => d.song);
  if (!songs.length) return { text: `Sorry, lagu buat ${m.label} nggak ketemu.`, clip: 'not_found', ok: false };
  songs = songs.sort(() => Math.random() - 0.5).slice(0, 40);
  remember(null, mood, songs);
  P.play(songs, 0, `Asisten: lagu ${m.label}`);
  return { text: more ? `Oke, lagu ${m.label} yang lain. Mulai dari ${songs[0].title}.` : `Siap, gua puterin lagu buat ${m.label}. Mulai dari ${songs[0].title}.`, clip: 'play', ok: true };
}

// ---------------------------------------------------------------- suara jawaban
let voiceList: string[] = [];
export function setVoiceClips(list: string[]) { voiceList = list; }
const clipAudio = new Audio();

function speak(r: Reply, done: () => void) {
  const mode = useSettings.getState().replyVoice;
  if (mode === 'off') return done();
  if (mode === 'dev') {
    const want = r.clip === 'not_found' ? 'ack' : r.clip;
    const file = voiceList.find((f) => f.startsWith(`${want}.`)) || voiceList.find((f) => f.startsWith('ack.'));
    if (file) {
      clipAudio.src = `/voice/${file}`;
      clipAudio.volume = 0.85;
      clipAudio.onended = done;
      clipAudio.onerror = done;
      clipAudio.play().catch(done);
      return;
    }
  }
  if (!('speechSynthesis' in window)) return done();
  const u = new SpeechSynthesisUtterance(r.text);
  u.lang = 'id-ID';
  u.rate = 1.05;
  u.volume = 0.6;
  const v = speechSynthesis.getVoices().find((x) => x.lang.startsWith('id'));
  if (v) u.voice = v;
  u.onend = done;
  u.onerror = done;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

// ---------------------------------------------------------------- panel asisten
type State = { kind: 'listening'; partial: string } | { kind: 'working'; said: string } | { kind: 'answer'; said: string; reply: string } | { kind: 'problem'; msg: string };

const HINTS = ['putar Tulus', 'yang lain dong', 'lagu buat belajar', 'buka koleksi', 'nyalakan karaoke', 'aku dengerin apa aja hari ini'];

export function AssistantPanel() {
  const ui = useUi();
  const exec = useExecutor();
  const [state, setState] = useState<State>({ kind: 'listening', partial: '' });
  const [typed, setTyped] = useState('');
  const rec = useRef<any>(null);
  const closeT = useRef<number>();
  const duck = useRef<number | null>(null);
  const wake = ui.assistantWake;

  const close = useCallback(() => { ui.set({ assistant: false, assistantWake: false, assistantInitial: '' }); }, [ui]);

  const handle = useCallback(async (text: string) => {
    const cmd = parse(text, wake);
    if (!cmd) {
      const r: Reply = { text: 'Sorry bro, gua belum ngerti. Coba bilang "putar" terus judul lagunya.', clip: 'not_found', ok: false };
      setState({ kind: 'answer', said: text, reply: r.text });
      speak(r, () => {});
      return;
    }
    setState({ kind: 'working', said: text });
    const r = await exec(cmd).catch((e) => ({ text: `Ada masalah: ${e.message}`, clip: 'not_found', ok: false } as Reply));
    setState({ kind: 'answer', said: text, reply: r.text });
    restoreVolume();
    speak(r, () => {});
    if (cmd.type !== 'help' && cmd.type !== 'whatsPlaying' && cmd.type !== 'summary') {
      const nav = cmd.type === 'open' || cmd.type === 'openPlaylist' || cmd.type === 'openArtist' || cmd.type === 'back';
      closeT.current = window.setTimeout(close, nav && r.ok ? 1200 : 2600);
    }
  }, [exec, wake, close]);

  const restoreVolume = () => {
    if (duck.current != null) { P.setVolume(duck.current); duck.current = null; }
  };

  const listen = useCallback(() => {
    window.clearTimeout(closeT.current);
    if (!SR) { setState({ kind: 'problem', msg: 'Browser ini belum mendukung perintah suara. Pakai Chrome/Edge, atau ketik perintahnya di bawah.' }); return; }
    rec.current?.abort?.();
    const r = new SR();
    r.lang = 'id-ID';
    r.interimResults = true;
    r.maxAlternatives = 1;
    let final = '';
    r.onresult = (e: any) => {
      let partial = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t; else partial += t;
      }
      setState({ kind: 'listening', partial: final + partial });
    };
    r.onerror = (e: any) => {
      restoreVolume();
      setState({ kind: 'problem', msg: e.error === 'not-allowed' ? 'Izin mikrofon dibutuhkan.' : e.error === 'no-speech' ? 'Tidak ada suara yang terdengar.' : e.error === 'network' ? 'Pengenal suara browser butuh internet.' : `Gagal mendengarkan (${e.error}).` });
    };
    r.onend = () => { if (final.trim()) handle(final.trim()); else restoreVolume(); };
    // Musik dikecilkan selama mendengarkan.
    if (duck.current == null && P.usePlayer.getState().playing) { duck.current = P.usePlayer.getState().volume; P.setVolume(duck.current * 0.2); }
    setState({ kind: 'listening', partial: '' });
    try { r.start(); rec.current = r; } catch { /* sudah berjalan */ }
  }, [handle]);

  useEffect(() => {
    const initial = useUi.getState().assistantInitial;
    if (initial) { useUi.getState().set({ assistantInitial: '' }); handle(initial); } else listen();
    return () => { rec.current?.abort?.(); window.clearTimeout(closeT.current); restoreVolume(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const listening = state.kind === 'listening';
  return (
    <div className="assistant" onClick={close}>
      <div className="panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Freease Smart">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="title" style={{ background: 'var(--accent-grad)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>Freease Smart</div>
          <button className="icon-btn sm" aria-label="Tutup" onClick={close}><X size={18} /></button>
        </div>
        <button className={`orb ${listening ? 'listen' : ''}`} aria-label="Dengarkan lagi" onClick={listen}><Mic size={40} /></button>
        <div className="said">
          {state.kind === 'listening' ? (state.partial || 'Mendengarkan…') : state.kind === 'problem' ? '' : `“${state.said}”`}
        </div>
        <div className="reply">
          {state.kind === 'working' ? 'Sebentar…' : state.kind === 'answer' ? state.reply : state.kind === 'problem' ? state.msg : 'Coba bilang:'}
        </div>
        {(state.kind === 'listening' || state.kind === 'problem') && (
          <div className="hints">{HINTS.map((h) => <button key={h} onClick={() => { rec.current?.abort?.(); handle(h); }}>{h}</button>)}</div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { rec.current?.abort?.(); handle(typed.trim()); setTyped(''); } }} style={{ marginTop: 16 }}>
          <input className="field" placeholder="…atau ketik perintah, mis. “putar Hindia”" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </form>
      </div>
    </div>
  );
}

/**
 * "Oke Freease" tanpa tombol: pengenal suara browser berjalan terus selama tab terlihat dan mencari
 * frasa panggilan. Sisa kalimat setelah panggilan langsung dijalankan ("oke freease, putar Tulus").
 */
export function WakeListener({ onWake }: { onWake: (rest: string) => void }) {
  const enabled = useSettings((s) => s.wakeWord);
  const assistantOpen = useUi((s) => s.assistant);
  useEffect(() => {
    if (!enabled || !SR || assistantOpen) return;
    let stopped = false;
    let r: any = null;
    const start = () => {
      if (stopped || document.hidden) return;
      r = new SR();
      r.lang = 'id-ID';
      r.continuous = true;
      r.interimResults = true;
      r.onresult = (e: any) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = String(e.results[i][0].transcript).toLowerCase();
          const m = /\b(oke|ok|okay|hai|hei)\s*,?\s*(freease|frease|freeze|fries|fris|friis|free|frees|price|fresh)\b(.*)$/.exec(t);
          if (m && e.results[i].isFinal) { stopped = true; r.abort(); onWake(m[3].trim()); return; }
          if (m && !m[3].trim()) { stopped = true; r.abort(); onWake(''); return; }
        }
      };
      r.onend = () => { if (!stopped) setTimeout(start, 300); };
      r.onerror = (e: any) => { if (e.error === 'not-allowed') stopped = true; };
      try { r.start(); } catch { /* sedang berjalan */ }
    };
    const vis = () => { if (!document.hidden && !stopped) start(); };
    start();
    document.addEventListener('visibilitychange', vis);
    return () => { stopped = true; r?.abort?.(); document.removeEventListener('visibilitychange', vis); };
  }, [enabled, assistantOpen, onWake]);
  return null;
}
