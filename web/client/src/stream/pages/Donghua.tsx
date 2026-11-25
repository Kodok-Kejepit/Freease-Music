// Beranda Donghua (animasi China, subtitle Indonesia): rilisan terbaru, rekomendasi, populer, sedang tayang, tamat.
import { useNavigate } from 'react-router-dom';
import { CalendarDays, Compass, Play, Star } from 'lucide-react';
import { fs, routes, type Anime } from '../api';
import { Failed, Img, PosterCard, Shelf, ShelfSkeleton, useLoad, useTitle } from '../ui';

const sub = (a: Anime) => [a.status, a.year].filter(Boolean).join(' • ') || a.source || '';

export default function Donghua() {
  useTitle('Donghua');
  const nav = useNavigate();
  const { data: h, error, retry } = useLoad((s) => fs.donghuaHome(s), []);
  const top = h?.latest[0];
  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div className="h1">Donghua</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="icon-btn" aria-label="Jelajah donghua" title="Jelajah donghua" onClick={() => nav('/stream/anime?src=ac')}><Compass size={22} /></button>
          <button className="icon-btn" aria-label="Jadwal donghua" title="Jadwal donghua" onClick={() => nav('/stream/jadwal?kind=donghua')}><CalendarDays size={22} /></button>
        </div>
      </div>
      <p className="sub" style={{ margin: '-6px 0 14px' }}>Animasi China subtitle Indonesia, sampai 1080p bila sumbernya ada.</p>

      {error && !h ? <Failed error={error} retry={retry} /> : !h ? <div className="skeleton" style={{ height: 260, borderRadius: 20 }} /> : top && (
        <div className="fhero">
          <div className="bg" style={{ backgroundImage: top.cover ? `url("${top.cover}")` : undefined }} />
          <div className="in">
            <div className="poster"><Img src={top.cover} /></div>
            <div className="txt">
              <div className="kicker">Baru rilis</div>
              <h1>{top.title}</h1>
              <div className="meta-row"><span className="pill grad">Episode {top.episode}</span><span className="pill">Donghua</span></div>
              <div className="actions" style={{ marginBottom: 0 }}>
                <button className="btn primary" onClick={() => nav(routes.watch(top.episodeId!))}><Play size={18} fill="currentColor" />Tonton Episode {top.episode}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {h ? (
        <>
          <Shelf title="Rilisan terbaru" more="/stream/anime?src=ac&order=latest">
            {h.latest.map((a) => <PosterCard key={a.id} to={routes.watch(a.episodeId!)} image={a.cover} title={a.title} sub="Anichin" badge={`Ep ${a.episode}`} />)}
          </Shelf>
          {h.recommended.length > 0 && <Shelf title="Rekomendasi">{h.recommended.map((a) => <PosterCard key={a.id} to={routes.anime(a.id)} image={a.cover} title={a.title} sub={sub(a)} />)}</Shelf>}
          <Shelf title="Paling populer" more="/stream/anime?src=ac&order=popular">{h.popular.map((a, i) => <PosterCard key={a.id} to={routes.anime(a.id)} image={a.cover} title={a.title} sub={sub(a)} badge={`#${i + 1}`} />)}</Shelf>
          <Shelf title="Sedang tayang" more="/stream/anime?src=ac&status=ongoing">{h.ongoing.map((a) => <PosterCard key={a.id} to={routes.anime(a.id)} image={a.cover} title={a.title} sub={sub(a)} />)}</Shelf>
          <Shelf title="Sudah tamat" more="/stream/anime?src=ac&status=completed">{h.completed.map((a) => <PosterCard key={a.id} to={routes.anime(a.id)} image={a.cover} title={a.title} sub={sub(a)} />)}</Shelf>
          {h.animekompi.length > 0 && <Shelf title="Donghua di Animekompi" more="/stream/anime?genre=donghua&order=latest">{h.animekompi.map((a) => <PosterCard key={a.id} to={routes.anime(a.id)} image={a.cover} title={a.title} sub={[a.status, a.year].filter(Boolean).join(' • ')} badgeR={a.rating ? `Skor ${a.rating}` : null} />)}</Shelf>}
        </>
      ) : !error && <><ShelfSkeleton /><ShelfSkeleton /></>}
      <p className="sub" style={{ marginTop: 30, textAlign: 'center' }}><Star size={12} style={{ verticalAlign: -1 }} /> Sumber: Anichin & Animekompi. Freease tidak menyimpan video.</p>
    </div>
  );
}
