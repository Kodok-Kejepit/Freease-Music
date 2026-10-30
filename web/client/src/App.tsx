import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { api } from './lib/api';
import { ACCENTS, useSettings } from './lib/settings';
import { toast } from './lib/toast';
import { next, prev, restoreQueue, seek, position, setVolume, toggle, usePlayer } from './player/player';
import { AssistantPanel, setVoiceClips, WakeListener } from './assistant/Assistant';
import { AddToPlaylistSheet, SongMenu, Toast } from './components/Menus';
import { BottomNav, MiniPlayer, NowPlaying, PlayerBar, SidePanel, Sidebar } from './components/Shell';
import { FullscreenControls } from './components/FullscreenControls';
import { SubtitleOverlay } from './components/SubtitleOverlay';
import './player/sponsor';
import './player/resume';
import { useUi } from './components/uiState';
import Home from './pages/Home';
import Search, { Category } from './pages/Search';
import Library, { Downloads, HistoryPage, Liked, LocalPlaylistPage, SmartPage } from './pages/Library';
import { Artist, RemotePlaylist, SharedSong } from './pages/Browse';
import Stats from './pages/Stats';
import Settings from './pages/Settings';
import Profile from './pages/Profile';
import LocalFiles from './pages/LocalFiles';

function Theme() {
  const accent = useSettings((s) => s.accent);
  const amoled = useSettings((s) => s.amoled);
  useEffect(() => {
    const a = ACCENTS[accent] ?? ACCENTS[0];
    document.documentElement.style.setProperty('--a', a.a);
    document.documentElement.style.setProperty('--b', a.b);
    document.documentElement.classList.toggle('amoled', amoled);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', amoled ? '#000000' : '#0A0A10');
  }, [accent, amoled]);
  return null;
}

/** Judul tab mengikuti lagu yang diputar. */
function TitleSync() {
  const song = usePlayer((s) => s.queue[s.index]);
  const playing = usePlayer((s) => s.playing);
  useEffect(() => { document.title = song ? `${song.title} · ${song.artist}${playing ? '' : ' (dijeda)'}` : 'Freease'; }, [song, playing]);
  return null;
}

function ScrollTop() {
  const { pathname, search } = useLocation();
  useEffect(() => { document.querySelector('.main')?.scrollTo({ top: 0 }); }, [pathname, search]);
  return null;
}

/** Pintasan keyboard (laptop/PC): Spasi putar/jeda, ←/→ maju-mundur 5 dtk, Shift+←/→ lagu, ↑/↓ volume, / cari. */
function Shortcuts() {
  const navigate = useNavigate();
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
      const vol = usePlayer.getState().volume;
      if (e.code === 'Space' || e.key === 'k') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); if (e.shiftKey) next(); else seek(position() + 5); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); if (e.shiftKey) prev(); else seek(position() - 5); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setVolume(vol + 0.1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setVolume(vol - 0.1); }
      else if (e.key === '/') {
        e.preventDefault();
        if (location.pathname !== '/search') navigate('/search');
        setTimeout(() => document.querySelector<HTMLInputElement>('input[aria-label="Cari"]')?.focus(), 50);
      }
      else if (e.key === 'm') { useUi.getState().set({ assistant: true, assistantWake: false }); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [navigate]);
  return null;
}

function Shell() {
  const ui = useUi();
  const hasSong = usePlayer((s) => s.index >= 0);
  const onWake = useCallback((rest: string) => {
    useUi.getState().set({ assistant: true, assistantWake: true, assistantInitial: rest });
  }, []);
  return (
    <div className={`app ${ui.panel && hasSong ? 'with-panel' : ''} ${hasSong ? '' : 'idle'}`}>
      <Sidebar />
      <main className="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/search" element={<Search />} />
          <Route path="/category" element={<Category />} />
          <Route path="/library" element={<Library />} />
          <Route path="/liked" element={<Liked />} />
          <Route path="/downloads" element={<Downloads />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/local" element={<LocalFiles />} />
          <Route path="/smart/:kind" element={<SmartPage />} />
          <Route path="/playlist/:id" element={<LocalPlaylistPage />} />
          <Route path="/remote/:id" element={<RemotePlaylist />} />
          <Route path="/artist/:id" element={<Artist />} />
          <Route path="/song/:id" element={<SharedSong />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      {hasSong && <SidePanel />}
      <div className="bottom">
        <MiniPlayer />
        {hasSong && <PlayerBar />}
        <BottomNav />
      </div>
      <NowPlaying />
      <FullscreenControls />
      <SubtitleOverlay />
      <SongMenu />
      <AddToPlaylistSheet />
      {ui.assistant && <AssistantPanel />}
      <WakeListener onWake={onWake} />
      <Toast />
      <ScrollTop />
      <Shortcuts />
      <TitleSync />
    </div>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  return (
    <div className="login">
      <form className="box" onSubmit={async (e) => { e.preventDefault(); try { await api.login(pw); onDone(); } catch (x) { setErr((x as Error).message); } }}>
        <img src="/logo.svg" alt="" />
        <div className="h1" style={{ margin: '0 0 6px' }}>Freease</div>
        <div className="sub" style={{ marginBottom: 18 }}>Server pribadi — masukkan kata sandi</div>
        <input className="field" type="password" autoFocus placeholder="Kata sandi" value={pw} onChange={(e) => setPw(e.target.value)} />
        {err && <div style={{ color: 'var(--danger)', marginTop: 8, fontSize: 14 }}>{err}</div>}
        <button className="btn primary" style={{ width: '100%', marginTop: 14 }} type="submit">Masuk</button>
      </form>
    </div>
  );
}

export default function App() {
  const [phase, setPhase] = useState<'loading' | 'login' | 'ready'>('loading');
  const load = useCallback(() => {
    api.config()
      .then((c) => {
        setVoiceClips(c.voice || []);
        if (c.needsPassword && !c.authed) setPhase('login');
        else { setPhase('ready'); restoreQueue(); }
      })
      .catch(() => { setPhase('ready'); restoreQueue(); toast('Server tidak terjangkau — hanya unduhan & berkas lokal yang bisa diputar'); });
  }, []);
  useEffect(load, [load]);
  return (
    <BrowserRouter>
      <Theme />
      {phase === 'loading' ? null : phase === 'login' ? <Login onDone={load} /> : <Shell />}
    </BrowserRouter>
  );
}
