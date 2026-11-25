// Detail anime: info, sinopsis, genre, daftar episode (tanda sudah ditonton & posisi), lanjutkan menonton.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowDownUp, Download, Play, Share2, Star } from 'lucide-react';
import { toast } from '../../lib/toast';
import { fs, routes } from '../api';
import { progressOf, seenOf, useStore } from '../store';
import { AltSources, FavButton, Failed, Img, Spinner, useLoad, useTitle } from '../ui';

export const genreSlug = (g: string) => g.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export async function share(title: string) {
  const url = location.href.split('?')[0];
  try {
    if (navigator.share) await navigator.share({ title, url });
    else { await navigator.clipboard.writeText(url); toast('Tautan disalin'); }
  } catch { /* dibatalkan */ }
}

export default function AnimeDetail() {
  const id = decodeURIComponent(useParams().id ?? '');
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { data: a, error, loading, retry } = useLoad((s) => fs.anime(id, s), [id]);
  const prog = useStore(() => progressOf('anime', id), undefined, [id]);
  const seen = useStore(() => seenOf('anime', id), new Map(), [id]);
  const [filter, setFilter] = useState('');
  const [newest, setNewest] = useState(false);
  const [more, setMore] = useState(false);
  useTitle(a?.title);

  const first = a?.episodes.length ? a.episodes[a.episodes.length - 1] : null;
  const target = prog ? { id: prog.itemId, label: `Lanjutkan ${prog.itemLabel}` } : first ? { id: first.id, label: `Tonton Episode ${first.number}` } : null;
  useEffect(() => {
    if (!a) return;
    // ?ep=N (dari rak rilis atau "sumber lain") langsung ke episode bernomor sama.
    const want = sp.get('ep');
    const hit = want ? a.episodes.find((e) => e.number === want) : null;
    if (hit) nav(routes.watch(hit.id), { replace: true });
    else if (sp.get('play') && target) nav(routes.watch(target.id), { replace: true });
  }, [a]); // eslint-disable-line react-hooks/exhaustive-deps

  const eps = useMemo(() => {
    const list = (a?.episodes ?? []).filter((e) => !filter || e.number.includes(filter.trim()) || e.title.toLowerCase().includes(filter.trim().toLowerCase()));
    return newest ? list : [...list].reverse();
  }, [a, filter, newest]);

  if (loading && !a) return <div className="page"><Spinner label="Memuat anime…" /></div>;
  if (error || !a) return <div className="page"><Failed error={error ?? 'Tidak ditemukan'} retry={retry} /></div>;
  return (
    <div className="page" style={{ position: 'relative', isolation: 'isolate' }}>
      <div className="hero-bg" style={{ backgroundImage: a.cover ? `url("${a.banner || a.cover}")` : undefined }} />
      <div className="dhead">
        <div className="poster"><Img src={a.cover} /></div>
        <div className="info">
          <div className="sub" style={{ fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', fontSize: 12 }}>{a.type === 'Donghua' ? 'Donghua' : `Anime${a.type ? ` · ${a.type}` : ''}`}</div>
          <h1>{a.title}</h1>
          {a.altTitles && <div className="alt">{a.altTitles}</div>}
          <div className="meta-row">
            {a.status && <span className={`pill ${a.status === 'Ongoing' ? 'grad' : ''}`}>{a.status}</span>}
            {a.rating && <span className="pill"><Star size={12} fill="currentColor" />{a.rating}</span>}
            {a.year && <span>{a.year}</span>}
            {a.studio && <span className="dot">{a.studio}</span>}
            <span className="dot">{a.episodes.length} episode</span>
            {a.source && <span className="dot">{a.source}</span>}
          </div>
          <div className="actions">
            {target && <button className="btn primary" onClick={() => nav(routes.watch(target.id))}><Play size={18} fill="currentColor" />{target.label}</button>}
            <FavButton kind="anime" id={a.id} title={a.title} cover={a.cover} sub={[a.type, a.year].filter(Boolean).join(' • ')} big />
            <button className="icon-btn" aria-label="Bagikan" title="Bagikan" onClick={() => void share(a.title)}><Share2 size={20} /></button>
          </div>
        </div>
      </div>

      {a.genres.length > 0 && <div className="genres">{a.genres.map((g) => <Link key={g} to={`/stream/anime?${a.source === 'Otakudesu' ? 'src=od&' : a.source === 'Anichin' ? 'src=ac&' : ''}genre=${genreSlug(g)}`}>{g}</Link>)}</div>}
      {a.synopsis && (
        <div style={{ marginTop: 12 }}>
          <p className={`synopsis ${more ? '' : 'clamp'}`} onClick={() => setMore(true)}>{a.synopsis}</p>
          {!more && a.synopsis.length > 280 && <button className="more sub" style={{ fontWeight: 700 }} onClick={() => setMore(true)}>Selengkapnya</button>}
        </div>
      )}

      <AltSources anime={a} />

      <div className="h2">Episode <span className="sub" style={{ fontWeight: 600 }}>{seen.size ? `${seen.size} sudah ditonton` : ''}</span></div>
      {a.episodes.length === 0 ? <div className="empty"><div className="title">Belum ada episode</div>Sumber belum mengunggah episode untuk judul ini.</div> : (
        <>
          <div className="ep-tools">
            {a.episodes.length > 12 && <input className="field" placeholder="Cari nomor episode…" value={filter} onChange={(e) => setFilter(e.target.value)} inputMode="numeric" aria-label="Cari episode" />}
            <button className="btn sm" onClick={() => setNewest((x) => !x)}><ArrowDownUp size={15} />{newest ? 'Terbaru dulu' : 'Terlama dulu'}</button>
          </div>
          <div className="ep-grid">
            {eps.map((e) => {
              const s = seen.get(e.id);
              const cur = prog?.itemId === e.id;
              return (
                <button key={e.id} className={`ep-btn ${cur ? 'cur' : s ? 'seen' : ''}`} title={e.title} onClick={() => nav(routes.watch(e.id))}>
                  {e.number || '?'}
                  {s && !cur && s.dur > 0 && <i style={{ width: `${Math.min(100, (s.pos / s.dur) * 100)}%` }} />}
                </button>
              );
            })}
          </div>
        </>
      )}

      {a.batch.length > 0 && (
        <>
          <div className="h2">Unduh batch</div>
          <div className="server-chips">{a.batch.map((b, i) => <a key={i} className="chip" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} href={b.url} target="_blank" rel="noopener noreferrer"><Download size={14} />{b.label}{b.resolution ? ` ${b.resolution}` : ''}</a>)}</div>
        </>
      )}
    </div>
  );
}
