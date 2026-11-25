import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { MoreVertical, Music2, Pause, Play, X } from 'lucide-react';
import { art, fmtTime } from '../lib/api';
import type { Song } from '../lib/types';
import { currentSong, usePlayer } from '../player/player';
import { useUi } from './uiState';

export function Artwork({ src, className = 'thumb', alt = '', round, style }: { src?: string | null; className?: string; alt?: string; round?: boolean; style?: React.CSSProperties }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) {
    return (
      <div className={className} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#2a2a3c,#1c1c28)', borderRadius: round ? '50%' : undefined, ...style }}>
        <Music2 size={20} color="#6b6b80" />
      </div>
    );
  }
  return <img className={className} src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} style={{ borderRadius: round ? '50%' : undefined, ...style }} />;
}

export function PlayingBars({ paused }: { paused?: boolean }) {
  return <span className={`bars ${paused ? 'paused' : ''}`}><i /><i /><i /></span>;
}

export function SongRow({ song, onPlay, index, wide, extra }: { song: Song; onPlay: () => void; index?: number; wide?: boolean; extra?: ReactNode }) {
  const cur = usePlayer((s) => s.queue[s.index]?.id === song.id);
  const playing = usePlayer((s) => s.playing);
  const openMenu = useUi((s) => s.openMenu);
  return (
    <div
      className={`song-row ${wide ? 'wide' : ''} ${cur ? 'playing' : ''}`}
      onClick={onPlay}
      onContextMenu={(e) => { e.preventDefault(); openMenu(song); }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onPlay()}
    >
      {index != null ? (
        <div className="num">{cur ? <PlayingBars paused={!playing} /> : index + 1}</div>
      ) : (
        <div style={{ position: 'relative' }}>
          <Artwork src={art(song)} />
          {cur && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6 }}>
              <PlayingBars paused={!playing} />
            </div>
          )}
        </div>
      )}
      <div style={{ minWidth: 0 }}>
        <div className="title ellipsis">{song.title}</div>
        <div className="sub ellipsis">
          {song.artistId ? <Link to={`/artist/${song.artistId}`} onClick={(e) => e.stopPropagation()} className="hover-u">{song.artist}</Link> : song.artist}
        </div>
      </div>
      {wide && <div className="album ellipsis hide-mobile">{song.album || ''}</div>}
      <div className="dur">{extra ?? (song.duration ? fmtTime(song.duration) : '')}</div>
      <button className="icon-btn sm menu-btn" aria-label="Menu lagu" onClick={(e) => { e.stopPropagation(); openMenu(song); }}>
        <MoreVertical size={18} />
      </button>
    </div>
  );
}

export function Slider({ value, max, onChange, onCommit, className = '', label }: { value: number; max: number; onChange?: (v: number) => void; onCommit: (v: number) => void; className?: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const pct = max > 0 ? Math.min(100, ((drag ?? value) / max) * 100) : 0;
  const at = (x: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (x - r.left) / r.width)) * max;
  };
  return (
    <div
      ref={ref}
      className={`slider ${drag != null ? 'drag' : ''} ${className}`}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      onKeyDown={(e) => {
        const step = max / 50;
        if (e.key === 'ArrowRight') onCommit(Math.min(max, value + step));
        if (e.key === 'ArrowLeft') onCommit(Math.max(0, value - step));
      }}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const v = at(e.clientX);
        setDrag(v);
        onChange?.(v);
      }}
      onPointerMove={(e) => {
        if (drag == null) return;
        const v = at(e.clientX);
        setDrag(v);
        onChange?.(v);
      }}
      onPointerUp={(e) => {
        if (drag == null) return;
        onCommit(at(e.clientX));
        setDrag(null);
      }}
      onPointerCancel={() => setDrag(null)}
    >
      <div className="track"><div className="fill" style={{ width: `${pct}%` }} /></div>
      <div className="knob" style={{ left: `${pct}%` }} />
    </div>
  );
}

export function Seekbar({ pos, duration, onSeek }: { pos: number; duration: number; onSeek: (s: number) => void }) {
  const [preview, setPreview] = useState<number | null>(null);
  return (
    <div className="seek">
      <span className="time">{fmtTime(preview ?? pos)}</span>
      <Slider value={pos} max={duration || 1} onChange={setPreview} onCommit={(v) => { setPreview(null); onSeek(v); }} label="Posisi lagu" />
      <span className="time">{fmtTime(duration)}</span>
    </div>
  );
}

export function PlayPause({ big, grad }: { big?: boolean; grad?: boolean }) {
  const playing = usePlayer((s) => s.playing);
  const buffering = usePlayer((s) => s.buffering);
  return (
    <button className={`play-btn ${big ? 'big' : ''} ${grad ? 'grad' : ''}`} aria-label={playing ? 'Jeda' : 'Putar'} onClick={() => import('../player/player').then((p) => p.toggle())}>
      {buffering && playing ? <div className="spinner" style={{ width: big ? 30 : 22, height: big ? 30 : 22, borderTopColor: grad ? '#fff' : '#000' }} /> : playing ? <Pause size={big ? 30 : 22} fill="currentColor" /> : <Play size={big ? 30 : 22} fill="currentColor" style={{ marginLeft: 3 }} />}
    </button>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export function Empty({ icon, title, sub, action }: { icon: ReactNode; title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <div className="title">{title}</div>
      {sub && <div style={{ maxWidth: 420 }}>{sub}</div>}
      {action}
    </div>
  );
}

export function Sheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="grip" />
        {children}
      </div>
    </div>
  );
}

export function Card({ to, onClick, image, title, sub, round, onPlay, onRemove }: { to?: string; onClick?: () => void; image?: string | null; title: string; sub?: string; round?: boolean; onPlay?: () => void; onRemove?: () => void }) {
  const body = (
    <>
      <div className="cover">
        <Artwork src={image} round={round} />
        {onRemove && (
          <button className="card-remove" aria-label={`Hapus ${title} dari riwayat`} title="Hapus dari riwayat" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}>
            <X size={14} />
          </button>
        )}
        {onPlay && (
          <button className="play-btn grad hover-play" aria-label={`Putar ${title}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPlay(); }}>
            <Play size={20} fill="currentColor" style={{ marginLeft: 2 }} />
          </button>
        )}
      </div>
      <div className="title ellipsis" style={{ fontSize: 14, textAlign: round ? 'center' : undefined }}>{title}</div>
      {sub && <div className="sub ellipsis" style={{ textAlign: round ? 'center' : undefined }}>{sub}</div>}
    </>
  );
  return to ? <Link to={to} className={`card ${round ? 'round' : ''}`}>{body}</Link> : <div className={`card ${round ? 'round' : ''}`} onClick={onClick} role="button">{body}</div>;
}

export function Loading() {
  return <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="spinner" /></div>;
}

export function ErrorBox({ error, retry }: { error: string; retry?: () => void }) {
  return <Empty icon={null} title="Gagal memuat" sub={error} action={retry && <button className="btn" onClick={retry}>Coba lagi</button>} />;
}

export function SongListSkeleton({ n = 6 }: { n?: number }) {
  return (
    <div>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} style={{ display: 'flex', gap: 12, padding: '6px 8px', alignItems: 'center' }}>
          <div className="skeleton" style={{ width: 48, height: 48 }} />
          <div style={{ flex: 1 }}>
            <div className="skeleton" style={{ height: 14, width: '60%', marginBottom: 8 }} />
            <div className="skeleton" style={{ height: 12, width: '35%' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export const nowPlaying = currentSong;

/** Kartu video ala YouTube: gambar 16:9 + durasi, judul 2 baris, kanal, jumlah tonton & tanggal. */
export function VideoCard({ song, onPlay }: { song: Song; onPlay: () => void }) {
  const cur = usePlayer((s) => s.queue[s.index]?.id === song.id);
  const openMenu = useUi((s) => s.openMenu);
  const meta = [song.views, song.published].filter(Boolean).join(' • ');
  return (
    <div className={`video-card ${cur ? 'playing' : ''}`} onClick={onPlay} onContextMenu={(e) => { e.preventDefault(); openMenu(song); }} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onPlay()}>
      <div className="vthumb">
        <img src={`https://i.ytimg.com/vi/${song.id}/mqdefault.jpg`} alt="" loading="lazy" />
        {song.live ? <span className="vbadge live">LANGSUNG</span> : song.duration > 0 && <span className="vbadge">{fmtTime(song.duration)}</span>}
      </div>
      <div className="vinfo">
        <div className="vtitle">{song.title}</div>
        <div className="sub ellipsis">{song.artist}</div>
        {meta && <div className="sub ellipsis">{meta}</div>}
      </div>
      <button className="icon-btn sm menu-btn" aria-label="Menu" onClick={(e) => { e.stopPropagation(); openMenu(song); }}><MoreVertical size={18} /></button>
    </div>
  );
}
