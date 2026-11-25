// Komponen bersama Freease Stream: poster, kartu, rak, keadaan memuat/galat, tombol favorit.
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, BookOpen, Bookmark, BookmarkCheck, ChevronRight, Film, Layers, Play, RotateCw } from 'lucide-react';
import { fs, routes } from './api';
import { toast } from '../lib/toast';
import { isFav, setFav, useStore, type Kind } from './store';

export function Img({ src, kind = 'anime', alt = '' }: { src?: string | null; kind?: Kind; alt?: string }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [src]);
  if (!src || bad) {
    const I = kind === 'anime' ? Film : BookOpen;
    return <div className="ph"><I size={26} /></div>;
  }
  return <img src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBad(true)} />;
}

/** Judul yang sama di sumber anime lain; [epNumber] membawa langsung ke episode itu. */
export function AltSources({ anime, epNumber, title = 'Juga tersedia di' }: { anime: { id: string; title: string; altTitles?: string | null }; epNumber?: string; title?: string }) {
  const { data } = useLoad((s) => fs.animeAlternatives(anime, s), [anime.id]);
  if (!data?.length) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div className="sub" style={{ fontWeight: 700, marginBottom: 8 }}>{title}</div>
      <div className="server-chips">
        {data.map((a) => (
          <Link key={a.id} className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} to={routes.anime(a.id) + (epNumber ? `?ep=${encodeURIComponent(epNumber)}` : '')}>
            <Layers size={14} />{a.source ?? 'Sumber lain'}{a.title !== anime.title ? ` · ${a.title}` : ''}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function PosterCard({ to, image, title, sub, kind = 'anime', badge, badgeR, progress }: {
  to: string; image?: string | null; title: string; sub?: ReactNode; kind?: Kind; badge?: string | null; badgeR?: string | null; progress?: number;
}) {
  return (
    <Link to={to} className="pcard" title={title}>
      <div className="pcover">
        <Img src={image} kind={kind} alt="" />
        {badge && <span className="badge">{badge}</span>}
        {badgeR && <span className="badge r grad">{badgeR}</span>}
        {progress != null && progress > 0 && <div className="pbar"><i style={{ width: `${Math.min(100, progress * 100)}%` }} /></div>}
        <div className="pplay"><span className="play-btn grad">{kind === 'anime' ? <Play size={20} fill="currentColor" style={{ marginLeft: 2 }} /> : <BookOpen size={20} />}</span></div>
      </div>
      <div className="pt">{title}</div>
      {sub && <div className="ps ellipsis">{sub}</div>}
    </Link>
  );
}

export function EpisodeCard({ to, image, title, ep, badge, progress }: { to: string; image?: string | null; title: string; ep: string; badge?: string | null; progress?: number }) {
  const nav = useNavigate();
  return (
    <div className="ecard" role="link" tabIndex={0} onClick={() => nav(to)} onKeyDown={(e) => e.key === 'Enter' && nav(to)}>
      <div className="eimg">
        <Img src={image} alt="" />
        {badge && <span className="badge">{badge}</span>}
        <span className="ep">{ep}</span>
        {progress != null && progress > 0 && <div className="pbar" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, background: 'rgba(255,255,255,.2)', zIndex: 2 }}><i style={{ display: 'block', height: '100%', width: `${Math.min(100, progress * 100)}%`, background: 'var(--accent-grad)' }} /></div>}
      </div>
      <div className="pt" style={{ fontWeight: 700, fontSize: 13.5, marginTop: 8, lineHeight: 1.3 }}><span className="ellipsis" style={{ display: 'block' }}>{title}</span></div>
    </div>
  );
}

export function Shelf({ title, more, wide, children }: { title: ReactNode; more?: string; wide?: boolean; children: ReactNode }) {
  return (
    <section>
      <div className="h2">
        <span>{title}</span>
        {more && <Link className="more" to={more} style={{ display: 'flex', alignItems: 'center' }}>Lihat semua<ChevronRight size={16} /></Link>}
      </div>
      <div className={`shelf ${wide ? 'wide' : 'posters'}`}>{children}</div>
    </section>
  );
}

export function ShelfSkeleton({ wide, n = 8 }: { wide?: boolean; n?: number }) {
  return (
    <div className={`shelf ${wide ? 'wide' : 'posters'}`} aria-hidden>
      {Array.from({ length: n }, (_, i) => <div key={i}><div className="skeleton" style={{ aspectRatio: wide ? '16/9' : '2/3', borderRadius: 10 }} /><div className="skeleton" style={{ height: 12, marginTop: 10, width: '80%' }} /></div>)}
    </div>
  );
}

export function GridSkeleton({ n = 18 }: { n?: number }) {
  return (
    <div className="grid-posters" aria-hidden>
      {Array.from({ length: n }, (_, i) => <div key={i}><div className="skeleton" style={{ aspectRatio: '2/3', borderRadius: 10 }} /><div className="skeleton" style={{ height: 12, marginTop: 10, width: '75%' }} /></div>)}
    </div>
  );
}

export function Failed({ error, retry }: { error: string; retry?: () => void }) {
  return (
    <div className="empty">
      <AlertTriangle size={40} />
      <div className="title">Gagal memuat</div>
      <div style={{ maxWidth: 420 }}>{error}</div>
      {retry && <button className="btn" onClick={retry}><RotateCw size={16} />Coba lagi</button>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return <div className="empty"><div className="spinner" />{label && <div>{label}</div>}</div>;
}

export function FavButton({ kind, id, title, cover, sub, big }: { kind: Kind; id: string; title: string; cover: string | null; sub?: string | null; big?: boolean }) {
  const on = useStore(() => isFav(kind, id), false, [kind, id]);
  const I = on ? BookmarkCheck : Bookmark;
  return (
    <button
      className={big ? `btn ${on ? '' : 'outline'}` : `icon-btn ${on ? 'on' : ''}`}
      aria-label={on ? 'Hapus dari koleksi' : 'Simpan ke koleksi'}
      title={on ? 'Hapus dari koleksi' : 'Simpan ke koleksi'}
      onClick={async () => { await setFav({ kind, id, title, cover, sub }, !on); toast(on ? 'Dihapus dari koleksi' : 'Disimpan ke koleksi'); }}
    >
      <I size={big ? 18 : 22} fill={on ? 'currentColor' : 'none'} />{big && (on ? 'Tersimpan' : 'Simpan')}
    </button>
  );
}

/** Data dari server; seperti useFetch musik tapi bisa melewati pemuatan bila argumen belum siap. */
export function useLoad<T>(load: ((signal: AbortSignal) => Promise<T>) | null, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: !!load });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!load) { setState({ data: null, error: null, loading: false }); return; }
    const ac = new AbortController();
    setState((s) => ({ data: s.data, error: null, loading: true }));
    load(ac.signal)
      .then((data) => !ac.signal.aborted && setState({ data, error: null, loading: false }))
      .catch((e) => !ac.signal.aborted && setState({ data: null, error: e.message || 'Gagal memuat', loading: false }));
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { ...state, retry: () => setN((x) => x + 1) };
}

export function useTitle(t: string | null | undefined) {
  useEffect(() => { document.title = t ? `${t} · Freease Stream` : 'Freease Stream'; }, [t]);
}
