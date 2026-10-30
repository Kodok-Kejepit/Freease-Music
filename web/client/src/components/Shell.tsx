import { Link, NavLink, useNavigate } from 'react-router-dom';
import {
  ChevronDown, ChevronUp, Clapperboard, Heart, Home, Library, ListMusic, Maximize, Maximize2, Mic, Music2, PictureInPicture2, ScrollText, MicVocal, MoreHorizontal, Repeat, Repeat1, Search, Shuffle,
  SkipBack, SkipForward, Timer, Volume1, Volume2, VolumeX, X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { art } from '../lib/api';
import * as db from '../lib/db';
import { useLibrary, usePosition } from '../lib/hooks';
import { toast } from '../lib/toast';
import { isLocalFile } from '../lib/types';
import {
  cycleRepeat, media, next, prev, seek, setKaraoke, setSleep, setSpeed, setVolume, toggleShuffle, usePlayer, videoHost,
} from '../player/player';
import { toggleFloatingLyrics, useLiveLyrics } from '../player/liveLyrics';
import { enterFullscreen, setVideoMode, targetHeight, useVideo } from '../player/video';
import { useSettings } from '../lib/settings';
import { LyricsView } from './Lyrics';
import { QueueList } from './Queue';
import { Artwork, PlayPause, Seekbar, Sheet, Slider } from './ui';
import { useUi } from './uiState';
import { VideoSlot } from './VideoSlot';
import { WatchView } from './Watch';

const NAV = [
  { to: '/', label: 'Beranda', icon: Home, end: true },
  { to: '/search', label: 'Cari', icon: Search },
  { to: '/library', label: 'Koleksi', icon: Library },
];

export function Sidebar() {
  const lists = useLibrary(db.playlists, []);
  const set = useUi((s) => s.set);
  return (
    <aside className="sidebar">
      <Link to="/" className="brand"><img src="/logo.svg" alt="" />Freease</Link>
      {NAV.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <n.icon size={22} />{n.label}
        </NavLink>
      ))}
      <button className="nav-item" onClick={() => set({ assistant: true, assistantWake: false })}><Mic size={22} />Freease Smart</button>
      <div className="side-label">Koleksi kamu</div>
      <div className="side-list">
        <NavLink to="/liked" className={({ isActive }) => `side-pl ${isActive ? 'active' : ''}`}>
          <div className="thumb" style={{ background: 'linear-gradient(135deg,#4b2bd1,#a78bfa)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Heart size={16} fill="#fff" color="#fff" /></div>
          Lagu yang Disukai
        </NavLink>
        <NavLink to="/downloads" className={({ isActive }) => `side-pl ${isActive ? 'active' : ''}`}>
          <div className="thumb" style={{ background: 'linear-gradient(135deg,#0fb57d,#0d5e91)' }} />
          Unduhan (offline)
        </NavLink>
        {lists.map((p) => (
          <NavLink key={p.id} to={`/playlist/${p.id}`} className={({ isActive }) => `side-pl ${isActive ? 'active' : ''}`}>
            <Artwork src={p.songs[0] ? art(p.songs[0]) : null} />
            <span className="ellipsis">{p.name}</span>
          </NavLink>
        ))}
      </div>
      <Link to="/profile" className="side-author" title="Profil pembuat Freease">
        <img src="/kodok-kejepit-96.webp" alt="" width={38} height={38} />
        <div style={{ minWidth: 0 }}><b>Kodok-Kejepit</b><span>Pembuat Freease</span></div>
      </Link>
    </aside>
  );
}

export function BottomNav() {
  const set = useUi((s) => s.set);
  return (
    <nav className="bottom-nav">
      {NAV.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
          <n.icon size={24} />{n.label}
        </NavLink>
      ))}
      <button onClick={() => set({ assistant: true, assistantWake: false })}><Mic size={24} />Smart</button>
    </nav>
  );
}

export function useLiked(id?: string) {
  return useLibrary(() => (id ? db.isLiked(id) : Promise.resolve(false)), false, [id]);
}

function LikeButton({ size = 20 }: { size?: number }) {
  const song = usePlayer((s) => s.queue[s.index]);
  const liked = useLiked(song?.id);
  if (!song || isLocalFile(song.id)) return null;
  return (
    <button className={`icon-btn ${liked ? 'on' : ''}`} aria-label={liked ? 'Hapus dari disukai' : 'Suka'} onClick={() => db.setLiked(song, !liked).then(() => toast(liked ? 'Dihapus dari Lagu yang Disukai' : 'Ditambahkan ke Lagu yang Disukai'))}>
      <Heart size={size} fill={liked ? 'currentColor' : 'none'} />
    </button>
  );
}

export function MiniPlayer() {
  const song = usePlayer((s) => s.queue[s.index]);
  const duration = usePlayer((s) => s.duration);
  const pos = usePosition(1000);
  const set = useUi((s) => s.set);
  if (!song) return null;
  return (
    <div className="mini" onClick={() => set({ nowPlaying: true })} role="button" aria-label="Buka pemutar">
      <Artwork src={art(song)} />
      <div className="meta">
        <div className="title ellipsis" style={{ fontSize: 14 }}>{song.title}</div>
        <div className="sub ellipsis">{song.artist}</div>
      </div>
      <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center' }}>
        <LikeButton />
        <PlayPause />
      </div>
      <div className="progress"><i style={{ width: `${duration ? (pos / duration) * 100 : 0}%` }} /></div>
    </div>
  );
}

export function RepeatButton() {
  const repeat = usePlayer((s) => s.repeat);
  return (
    <button className={`icon-btn ${repeat !== 'off' ? 'on' : ''}`} aria-label="Ulangi" onClick={cycleRepeat} title={repeat === 'one' ? 'Ulangi satu lagu' : repeat === 'all' ? 'Ulangi semua' : 'Ulangi mati'}>
      {repeat === 'one' ? <Repeat1 size={20} /> : <Repeat size={20} />}
    </button>
  );
}
export function ShuffleButton() {
  const shuffle = usePlayer((s) => s.shuffle);
  return <button className={`icon-btn ${shuffle ? 'on' : ''}`} aria-label="Acak" onClick={toggleShuffle}><Shuffle size={20} /></button>;
}

function VolumeControl() {
  const volume = usePlayer((s) => s.volume);
  const Icon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <button className="icon-btn sm" aria-label="Bisukan" onClick={() => setVolume(volume ? 0 : 1)}><Icon size={18} /></button>
      <Slider className="volume" value={volume} max={1} onChange={setVolume} onCommit={setVolume} label="Volume" />
    </div>
  );
}

function KaraokeButton() {
  const karaoke = usePlayer((s) => s.karaoke);
  return <button className={`icon-btn ${karaoke ? 'on' : ''}`} aria-label="Mode Karaoke" title="Mode Karaoke (vokal dihilangkan)" onClick={() => { setKaraoke(!karaoke); if (!karaoke) toast('Karaoke (beta): vokal dikurangi tanpa AI — hasilnya belum sempurna, musik bisa terdengar aneh'); }}><MicVocal size={20} /></button>;
}

export function PlayerBar() {
  const song = usePlayer((s) => s.queue[s.index]);
  const duration = usePlayer((s) => s.duration);
  const pos = usePosition();
  const ui = useUi();
  const nav = useNavigate();
  return (
    <div className="player-bar">
      <div className="pb-song">
        {song && (
          <>
            <button className="pb-art" aria-label="Buka layar pemutar" title="Buka layar pemutar" onClick={() => ui.set({ nowPlaying: true })}>
              <Artwork src={art(song)} className="thumb" />
              <span className="pb-art-hint"><ChevronUp size={18} /></span>
            </button>
            <div style={{ minWidth: 0 }}>
              <div className="title ellipsis" style={{ cursor: 'pointer' }} onClick={() => ui.set({ nowPlaying: true })}>{song.title}</div>
              <div className="sub ellipsis" style={{ cursor: song.artistId ? 'pointer' : undefined }} onClick={() => song.artistId && nav(`/artist/${song.artistId}`)}>{song.artist}</div>
            </div>
            <LikeButton size={18} />
          </>
        )}
      </div>
      <div className="pb-center">
        <div className="pb-controls">
          <ShuffleButton />
          <button className="icon-btn" aria-label="Sebelumnya" onClick={prev}><SkipBack size={22} fill="currentColor" /></button>
          <PlayPause />
          <button className="icon-btn" aria-label="Berikutnya" onClick={() => next()}><SkipForward size={22} fill="currentColor" /></button>
          <RepeatButton />
        </div>
        <Seekbar pos={pos} duration={duration} onSeek={seek} />
      </div>
      <div className="pb-right">
        <KaraokeButton />
        <button className={`icon-btn ${ui.panel === 'lyrics' ? 'on' : ''}`} aria-label="Lirik" title="Lirik" onClick={() => ui.set({ panel: ui.panel === 'lyrics' ? null : 'lyrics' })}><ScrollText size={20} /></button>
        <FloatingLyricsButton />
        <button className={`icon-btn ${ui.panel === 'queue' ? 'on' : ''}`} aria-label="Antrean" title="Antrean" onClick={() => ui.set({ panel: ui.panel === 'queue' ? null : 'queue' })}><ListMusic size={20} /></button>
        <VolumeControl />
        <button className="icon-btn" aria-label="Buka layar pemutar" title="Layar pemutar (lirik, video, antrean)" disabled={!song} onClick={() => ui.set({ nowPlaying: true })}><Maximize2 size={18} /></button>
      </div>
    </div>
  );
}

export function SidePanel() {
  const panel = useUi((s) => s.panel);
  const set = useUi((s) => s.set);
  const song = usePlayer((s) => s.queue[s.index]);
  if (!panel) return null;
  return (
    <aside className="side-panel">
      <div className="head">
        {panel === 'queue' ? 'Antrean' : 'Lirik'}
        <button className="icon-btn sm" aria-label="Tutup panel" onClick={() => set({ panel: null })}><X size={18} /></button>
      </div>
      <div className="body" style={panel === 'lyrics' ? { padding: 0, display: 'flex' } : undefined}>
        {panel === 'queue' ? <QueueList /> : song ? <div style={{ flex: 1, display: 'flex', minHeight: 0 }}><LyricsView song={song} compact /></div> : null}
      </div>
    </aside>
  );
}

export function MoreSheet({ onClose }: { onClose: () => void }) {
  const speed = usePlayer((s) => s.speed);
  const keepPitch = usePlayer((s) => s.keepPitch);
  const sleepAt = usePlayer((s) => s.sleepAt);
  const sleepEnd = usePlayer((s) => s.sleepEndOfSong);
  const song = usePlayer((s) => s.queue[s.index]);
  const openMenu = useUi((s) => s.openMenu);
  return (
    <Sheet onClose={onClose}>
      <div className="dialog">
        <h3>Kecepatan: {speed.toFixed(2)}×</h3>
        <input type="range" min={0.5} max={2} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} style={{ width: '100%' }} aria-label="Kecepatan" />
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
          <input type="checkbox" checked={keepPitch} onChange={(e) => setSpeed(speed, e.target.checked)} /> Nada tetap (tidak ikut berubah)
        </label>
        <h3 style={{ marginTop: 22 }}><Timer size={18} style={{ verticalAlign: -3 }} /> Timer tidur {sleepAt ? `· sisa ${Math.ceil((sleepAt - Date.now()) / 60000)} mnt` : sleepEnd ? '· akhir lagu' : ''}</h3>
        <div className="chips" style={{ flexWrap: 'wrap' }}>
          {[15, 30, 45, 60, 90].map((m) => <button key={m} className="chip" onClick={() => { setSleep(m); toast(`Musik berhenti dalam ${m} menit`); onClose(); }}>{m} menit</button>)}
          <button className="chip" onClick={() => { setSleep('end'); toast('Berhenti di akhir lagu ini'); onClose(); }}>Akhir lagu</button>
          {(sleepAt || sleepEnd) && <button className="chip on" onClick={() => { setSleep(null); toast('Timer tidur dibatalkan'); }}>Batalkan</button>}
        </div>
        <QualityPicker />
        {song && <div className="row"><button className="btn" onClick={() => { onClose(); openMenu(song); }}><MoreHorizontal size={18} /> Menu lagu</button></div>}
      </div>
    </Sheet>
  );
}

export function NowPlaying() {
  const ui = useUi();
  const song = usePlayer((s) => s.queue[s.index]);
  const from = usePlayer((s) => s.from);
  const duration = usePlayer((s) => s.duration);
  const mode = usePlayer((s) => s.mode);
  const hasVideo = usePlayer((s) => s.hasVideo);
  const karaoke = usePlayer((s) => s.karaoke);
  const videoMode = useSettings((s) => s.videoMode);
  const video = useVideo();
  const pos = usePosition();
  const [more, setMore] = useState(false);
  const [tab, setTab] = useState<'lyrics' | 'queue'>('lyrics');
  const nav = useNavigate();
  useEffect(() => {
    if (!ui.nowPlaying) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && ui.set({ nowPlaying: false });
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [ui.nowPlaying]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!song) ui.set({ nowPlaying: false }); }, [song]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ui.nowPlaying || !song) return null;
  const close = () => ui.set({ nowPlaying: false, npTab: null });
  // Video dari mode YouTube → layar tonton ala YouTube.
  if (song.yt) return <WatchView close={close} />;
  const mobileTab = ui.npTab;
  const big = art(song, true);
  const companion = video.active && video.ready;
  const showVideo = companion || (hasVideo && media.videoWidth > 0);
  const canVideo = mode === 'stream' && !isLocalFile(song.id);
  return (
    <div className={`np ${showVideo && !mobileTab ? 'theater' : ''}`} role="dialog" aria-label="Sedang diputar">
      <div className="np-bg" style={{ backgroundImage: big ? `url("${big}")` : undefined }} />
      <div className="np-top">
        <button className="icon-btn" aria-label="Tutup" onClick={close}><ChevronDown size={26} /></button>
        <div className="from">{from ? <>DIPUTAR DARI<br /><b style={{ color: 'var(--text)' }}>{from}</b></> : 'SEDANG DIPUTAR'}</div>
        <button className="icon-btn" aria-label="Lainnya" onClick={() => setMore(true)}><MoreHorizontal size={22} /></button>
      </div>
      <div className="np-body">
        <div className="np-main">
          {mobileTab ? (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', margin: '0 -24px' }} className="np-tabs-mobile">
              {mobileTab === 'lyrics' ? <LyricsView song={song} /> : <div style={{ overflowY: 'auto', padding: '0 12px' }}><QueueList /></div>}
            </div>
          ) : (
            <>
              {(canVideo || showVideo) && (
                <div className="np-seg">
                  {canVideo && (
                    <div className="seg" role="group" aria-label="Tampilan">
                      <button className={!videoMode ? 'on' : ''} onClick={() => setVideoMode(false)}><Music2 size={15} />Lagu</button>
                      <button className={videoMode ? 'on' : ''} onClick={() => setVideoMode(true)}><Clapperboard size={15} />Video</button>
                    </div>
                  )}
                  {showVideo && <button className="icon-btn sm" aria-label="Layar penuh" title="Layar penuh (atau ketuk dua kali video)" onClick={() => void enterFullscreen(videoHost)}><Maximize size={18} /></button>}
                </div>
              )}
              <div className="np-art">
                {showVideo ? <VideoSlot host={videoHost} className="np-video" /> : (
                  <div style={{ position: 'relative' }}>
                    <Artwork src={big} />
                    {video.active && !video.ready && <div className="sub" style={{ position: 'absolute', left: 0, right: 0, bottom: -26, textAlign: 'center' }}>Memuat video…</div>}
                  </div>
                )}
              </div>
            </>
          )}
          <div className="np-title">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="t ellipsis">{song.title}</div>
              <div className="sub ellipsis" style={{ fontSize: 15, cursor: song.artistId ? 'pointer' : undefined }} onClick={() => { if (song.artistId) { close(); nav(`/artist/${song.artistId}`); } }}>{song.artist}</div>
            </div>
            <LikeButton size={24} />
          </div>
          <div style={{ marginTop: 14 }}><Seekbar pos={pos} duration={duration} onSeek={seek} /></div>
          <div className="np-controls">
            <ShuffleButton />
            <button className="icon-btn" style={{ width: 52, height: 52 }} aria-label="Sebelumnya" onClick={prev}><SkipBack size={30} fill="currentColor" /></button>
            <PlayPause big />
            <button className="icon-btn" style={{ width: 52, height: 52 }} aria-label="Berikutnya" onClick={() => next()}><SkipForward size={30} fill="currentColor" /></button>
            <RepeatButton />
          </div>
          <div className="np-extra">
            <KaraokeButton />
            <div style={{ display: 'flex', gap: 4 }}>
              <button className={`icon-btn np-tabs-mobile ${mobileTab === 'lyrics' ? 'on' : ''}`} aria-label="Lirik" onClick={() => ui.set({ npTab: mobileTab === 'lyrics' ? null : 'lyrics' })}><ScrollText size={20} /></button>
              <FloatingLyricsButton />
              <button className={`icon-btn np-tabs-mobile ${mobileTab === 'queue' ? 'on' : ''}`} aria-label="Antrean" onClick={() => ui.set({ npTab: mobileTab === 'queue' ? null : 'queue' })}><ListMusic size={20} /></button>
            </div>
            <button className="icon-btn" aria-label="Kecepatan & timer" onClick={() => setMore(true)}><Timer size={20} /></button>
          </div>
          {karaoke && <div className="sub" style={{ textAlign: 'center', marginTop: 8, color: 'var(--a)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><MicVocal size={16} />Mode Karaoke aktif (beta — belum sempurna)</div>}
        </div>
        <div className="np-side">
          <div className="tabs">
            <button className={`tab ${tab === 'lyrics' ? 'on' : ''}`} onClick={() => setTab('lyrics')}>Lirik</button>
            <button className={`tab ${tab === 'queue' ? 'on' : ''}`} onClick={() => setTab('queue')}>Antrean</button>
          </div>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: tab === 'queue' ? 'auto' : undefined, padding: tab === 'queue' ? '8px' : 0 }}>
            {tab === 'lyrics' ? <LyricsView song={song} /> : <QueueList />}
          </div>
        </div>
      </div>
      {more && <MoreSheet onClose={() => setMore(false)} />}
    </div>
  );
}

/** Saat layar pemutar tertutup & mode player YouTube: video kecil mengambang (wajib terlihat). */
export function FloatingLyricsButton() {
  const on = useLiveLyrics((l) => l.floating);
  return (
    <button className={`icon-btn ${on ? 'on' : ''}`} aria-label="Lirik melayang" title="Lirik melayang" onClick={() => void toggleFloatingLyrics()}>
      <PictureInPicture2 size={20} />
    </button>
  );
}

const HEIGHTS = [360, 480, 720, 1080, 1440, 2160];
function QualityPicker() {
  const st = useSettings();
  const video = useVideo();
  const avail = video.heights.length ? HEIGHTS.filter((h) => h <= Math.max(...video.heights)) : HEIGHTS.slice(0, 4);
  return (
    <>
      <h3 style={{ marginTop: 22 }}>Kualitas video {video.active ? `· ${Math.min(targetHeight(), Math.max(...(video.heights.length ? video.heights : [targetHeight()])))}p` : ''}</h3>
      <div className="chips" style={{ flexWrap: 'wrap' }}>
        <button className={`chip ${st.videoQuality === 0 ? 'on' : ''}`} onClick={() => st.set({ videoQuality: 0 })}>Otomatis</button>
        {avail.map((h) => <button key={h} className={`chip ${st.videoQuality === h ? 'on' : ''}`} onClick={() => st.set({ videoQuality: h })}>{h >= 2160 ? '4K' : h >= 1440 ? '2K' : `${h}p`}</button>)}
      </div>
      <h3 style={{ marginTop: 18 }}>Kualitas audio</h3>
      <div className="chips" style={{ flexWrap: 'wrap' }}>
        <button className={`chip ${st.audioQuality === 'high' ? 'on' : ''}`} onClick={() => { st.set({ audioQuality: 'high' }); toast('Berlaku mulai lagu berikutnya'); }}>Tinggi (±160 kbps)</button>
        <button className={`chip ${st.audioQuality === 'low' ? 'on' : ''}`} onClick={() => { st.set({ audioQuality: 'low' }); toast('Berlaku mulai lagu berikutnya'); }}>Hemat data (±50 kbps)</button>
      </div>
    </>
  );
}
