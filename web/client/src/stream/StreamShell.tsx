// Kerangka Freease Stream: sidebar (laptop) dan navigasi bawah (HP) bergaya sama dengan Freease Musik.
import { useEffect } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { BookOpen, CalendarDays, Home, Library, Search, Swords, Tv } from 'lucide-react';
import { Switcher } from './Switcher';
import { Artwork, PlayPause } from '../components/ui';
import { Toast } from '../components/Menus';
import { art } from '../lib/api';
import { usePlayer } from '../player/player';
import { useStore, recent } from './store';
import { Img } from './ui';
import StreamHome from './pages/Home';
import Donghua from './pages/Donghua';
import AnimeBrowse from './pages/AnimeBrowse';
import AnimeDetail from './pages/AnimeDetail';
import Watch from './pages/Watch';
import Schedule from './pages/Schedule';
import MangaBrowse from './pages/MangaBrowse';
import MangaDetail from './pages/MangaDetail';
import Reader from './pages/Reader';
import StreamLibrary from './pages/Library';
import StreamSearch from './pages/Search';
import './stream.css';

const NAV = [
  { to: '/stream', label: 'Beranda', icon: Home, end: true },
  { to: '/stream/anime', label: 'Anime', icon: Tv },
  { to: '/stream/donghua', label: 'Donghua', icon: Swords },
  { to: '/stream/komik', label: 'Komik', icon: BookOpen },
  { to: '/stream/jadwal', label: 'Jadwal', icon: CalendarDays, desktop: true },
  { to: '/stream/cari', label: 'Cari', icon: Search },
  { to: '/stream/koleksi', label: 'Koleksi', icon: Library },
];

function Sidebar() {
  const items = useStore(() => recent(undefined, 8), []);
  return (
    <aside className="sidebar">
      <Link to="/" className="brand"><img src="/logo.svg" alt="" />Freease <span style={{ background: 'var(--accent-grad)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>Stream</span></Link>
      <Switcher active="stream" />
      {NAV.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <n.icon size={22} />{n.label}
        </NavLink>
      ))}
      <div className="side-label">Terakhir dibuka</div>
      <div className="side-list">
        {items.length === 0 && <div className="sub" style={{ padding: '4px 12px' }}>Belum ada. Tonton anime atau baca komik dulu.</div>}
        {items.map((p) => (
          <Link key={p.key} to={p.kind === 'anime' ? `/stream/watch/${encodeURIComponent(p.itemId)}` : `/stream/read/${encodeURIComponent(p.id)}/${encodeURIComponent(p.itemId)}`} className="side-pl">
            <div className="thumb" style={{ overflow: 'hidden', width: 36, height: 48 }}><div className="pcard" style={{ pointerEvents: 'none' }}><Img src={p.cover} kind={p.kind} /></div></div>
            <div style={{ minWidth: 0 }}>
              <div className="ellipsis" style={{ color: 'var(--text)', fontWeight: 600 }}>{p.title}</div>
              <div className="ellipsis" style={{ fontSize: 12 }}>{p.itemLabel}</div>
            </div>
          </Link>
        ))}
      </div>
      <Link to="/profile" className="side-author" title="Profil pembuat Freease">
        <img src="/pp-96.webp" alt="" width={38} height={38} />
        <div style={{ minWidth: 0 }}><b>Kodok-Kejepit</b><span>Pembuat Freease</span></div>
      </Link>
    </aside>
  );
}

function BottomNav() {
  return (
    <nav className="bottom-nav">
      {NAV.filter((n) => !n.desktop).map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
          <n.icon size={24} />{n.label}
        </NavLink>
      ))}
    </nav>
  );
}

/** Musik yang masih berjalan saat pindah ke Stream: tetap bisa dijeda tanpa kembali. */
function MusicPill() {
  const song = usePlayer((s) => s.queue[s.index]);
  const playing = usePlayer((s) => s.playing);
  const { pathname } = useLocation();
  if (!song || !playing || pathname.startsWith('/stream/watch') || pathname.startsWith('/stream/read')) return null;
  return (
    <div className="music-pill">
      <Link to="/music" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }} title="Kembali ke Freease Musik">
        <Artwork src={art(song)} />
        <span className="ellipsis">{song.title}</span>
      </Link>
      <PlayPause />
    </div>
  );
}

function ScrollTop() {
  const { pathname, search } = useLocation();
  useEffect(() => { document.querySelector('.main')?.scrollTo({ top: 0 }); }, [pathname, search]);
  return null;
}

export default function StreamShell() {
  const { pathname } = useLocation();
  const immersive = pathname.startsWith('/stream/read/');
  return (
    <div className="app stream idle">
      <Sidebar />
      <main className="main">
        <Routes>
          <Route index element={<StreamHome />} />
          <Route path="anime" element={<AnimeBrowse />} />
          <Route path="donghua" element={<Donghua />} />
          <Route path="anime/:id" element={<AnimeDetail />} />
          <Route path="watch/:id" element={<Watch />} />
          <Route path="jadwal" element={<Schedule />} />
          <Route path="komik" element={<MangaBrowse />} />
          <Route path="manga/:id" element={<MangaDetail />} />
          <Route path="read/:mangaId/:chapterId" element={<Reader />} />
          <Route path="koleksi" element={<StreamLibrary />} />
          <Route path="cari" element={<StreamSearch />} />
          <Route path="*" element={<StreamHome />} />
        </Routes>
      </main>
      {!immersive && <div className="bottom"><BottomNav /></div>}
      <MusicPill />
      <Toast />
      <ScrollTop />
    </div>
  );
}
