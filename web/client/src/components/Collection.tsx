import type { ReactNode } from 'react';
import { Play, Shuffle } from 'lucide-react';
import { fmtTime } from '../lib/api';
import type { Song } from '../lib/types';
import { play } from '../player/player';
import { Artwork, SongListSkeleton, SongRow } from './ui';

/** Halaman daftar lagu (playlist, album, disukai, unduhan, artis): sampul, tombol putar/acak, daftar. */
export function Collection({
  title, kind, subtitle, cover, coverNode, round, songs, from, loading, actions, numbered, empty, children, rowExtra,
}: {
  title: string;
  kind?: string;
  subtitle?: ReactNode;
  cover?: string | null;
  coverNode?: ReactNode;
  round?: boolean;
  songs: Song[];
  from: string;
  loading?: boolean;
  actions?: ReactNode;
  numbered?: boolean;
  empty?: ReactNode;
  children?: ReactNode;
  rowExtra?: (s: Song, i: number) => ReactNode;
}) {
  const total = songs.reduce((a, s) => a + (s.duration || 0), 0);
  return (
    <div className="page" style={{ position: 'relative', isolation: 'isolate' }}>
      {cover && <div className="hero-bg" style={{ backgroundImage: `url("${cover}")` }} />}
      <div className={`hero ${round ? 'round' : ''}`}>
        <div className="cover">{coverNode ?? <Artwork src={cover} round={round} />}</div>
        <div className="info">
          {kind && <div className="sub" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, fontSize: 12 }}>{kind}</div>}
          <h1>{title}</h1>
          <div className="sub">
            {subtitle}
            {songs.length > 0 && <>{subtitle ? ' • ' : ''}{songs.length} lagu{total > 0 ? ` • ${fmtTime(total)}` : ''}</>}
          </div>
        </div>
      </div>
      <div className="actions">
        <button className="play-btn big grad" aria-label="Putar semua" disabled={!songs.length} onClick={() => play(songs, 0, from)}><Play size={28} fill="currentColor" style={{ marginLeft: 3 }} /></button>
        <button className="icon-btn" style={{ width: 48, height: 48 }} aria-label="Putar acak" disabled={!songs.length} onClick={() => play(songs, 0, from, true)}><Shuffle size={24} /></button>
        {actions}
      </div>
      {children}
      {loading ? <SongListSkeleton /> : songs.length === 0 ? empty : songs.map((s, i) => (
        <SongRow key={`${s.id}-${i}`} song={s} index={numbered ? i : undefined} wide onPlay={() => play(songs, i, from)} extra={rowExtra?.(s, i)} />
      ))}
    </div>
  );
}
