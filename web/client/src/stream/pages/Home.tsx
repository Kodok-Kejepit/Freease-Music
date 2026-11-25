// Beranda Freease Stream: sorotan, lanjutkan menonton/membaca, episode terbaru, dan rak anime & komik.
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarDays, Info, Play, Search, Settings as Gear, Star, X } from 'lucide-react';
import { fs, routes, ago, type Anime } from '../api';
import { forget, recent, useStore } from '../store';
import { Switcher } from '../Switcher';
import { EpisodeCard, Failed, Img, PosterCard, Shelf, ShelfSkeleton, useLoad, useTitle } from '../ui';

function greeting() {
  const h = new Date().getHours();
  return h < 4 ? 'Begadang nonton?' : h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 19 ? 'Selamat sore' : 'Selamat malam';
}

function Hero({ items }: { items: Anime[] }) {
  const [i, setI] = useState(0);
  const nav = useNavigate();
  useEffect(() => {
    if (items.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % items.length), 7000);
    return () => clearInterval(t);
  }, [items.length, i]);
  const a = items[i];
  if (!a) return null;
  return (
    <div className="fhero">
      <div className="bg" style={{ backgroundImage: a.cover ? `url("${a.banner || a.cover}")` : undefined }} />
      <div className="in" key={a.id}>
        <div className="poster"><Img src={a.cover} /></div>
        <div className="txt">
          <div className="kicker">Sorotan</div>
          <h1>{a.title}</h1>
          <div className="meta-row">
            {a.type && <span className="pill">{a.type}</span>}
            {a.status && <span className={`pill ${a.status === 'Ongoing' ? 'grad' : ''}`}>{a.status}</span>}
            {a.rating && <span className="pill"><Star size={12} fill="currentColor" />{a.rating}</span>}
            {a.year && <span className="dot">{a.year}</span>}
          </div>
          {a.synopsis && <p className="syn">{a.synopsis}</p>}
          <div className="actions" style={{ marginBottom: 0 }}>
            <button className="btn primary" onClick={() => nav(routes.anime(a.id) + '?play=1')}><Play size={18} fill="currentColor" />Tonton</button>
            <button className="btn" onClick={() => nav(routes.anime(a.id))}><Info size={18} />Detail</button>
          </div>
        </div>
      </div>
      <div className="dots">{items.map((x, j) => <button key={x.id} className={j === i ? 'on' : ''} aria-label={`Sorotan ${j + 1}`} onClick={() => setI(j)} />)}</div>
    </div>
  );
}

function Continue() {
  const items = useStore(() => recent(undefined, 16), []);
  if (!items.length) return null;
  return (
    <Shelf title="Lanjutkan" more="/stream/koleksi" wide>
      {items.map((p) => (
        <div key={p.key} style={{ position: 'relative' }}>
          <EpisodeCard
            to={p.kind === 'anime' ? routes.watch(p.itemId) : routes.read(p.id, p.itemId)}
            image={p.cover} title={p.title} ep={p.itemLabel} badge={p.kind === 'anime' ? 'Anime' : 'Komik'}
            progress={p.kind === 'anime' ? (p.dur ? p.pos / p.dur : 0) : p.pages ? ((p.page ?? 0) + 1) / p.pages : 0}
          />
          <button className="card-remove" style={{ position: 'absolute', right: 6, top: 6, zIndex: 3 }} aria-label="Hapus dari Lanjutkan" title="Hapus dari Lanjutkan" onClick={() => void forget(p.kind, p.id)}><X size={14} /></button>
        </div>
      ))}
    </Shelf>
  );
}

const sub = (a: Anime) => [a.type, a.year, a.status].filter(Boolean).join(' • ');

export default function StreamHome() {
  useTitle(null);
  const nav = useNavigate();
  const anime = useLoad((s) => fs.animeHome(s), []);
  const manga = useLoad((s) => fs.mangaHome(s), []);
  const dh = useLoad((s) => fs.donghuaHome(s), []);
  const h = anime.data;
  const m = manga.data;
  return (
    <div className="page">
      <Switcher active="stream" top />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="h1">{greeting()}</div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button className="icon-btn" aria-label="Cari" onClick={() => nav('/stream/cari')}><Search size={22} /></button>
          <button className="icon-btn" aria-label="Jadwal rilis" onClick={() => nav('/stream/jadwal')}><CalendarDays size={22} /></button>
          <button className="icon-btn" aria-label="Pengaturan" onClick={() => nav('/settings')}><Gear size={22} /></button>
        </div>
      </div>

      {anime.error && !h ? <Failed error={anime.error} retry={anime.retry} /> : h ? <Hero items={h.featured.length ? h.featured : h.trending.slice(0, 6)} /> : <div className="skeleton" style={{ height: 320, borderRadius: 20 }} />}

      <Continue />

      <Shelf title="Episode terbaru" more="/stream/anime?order=latest" wide>
        {h ? h.latest.map((e) => <EpisodeCard key={e.episodeId} to={routes.watch(e.episodeId)} image={e.cover} title={e.title} ep={`Episode ${e.episode}`} badge={ago(e.at)} />) : null}
      </Shelf>
      {!h && !anime.error && <ShelfSkeleton wide />}
      {(h?.od?.latest.length ?? 0) > 0 && (
        <Shelf title="Rilis terbaru Otakudesu" more="/stream/anime?src=od">
          {h!.od!.latest.map((a) => <PosterCard key={a.id} to={routes.anime(a.id) + '?ep=' + encodeURIComponent(a.episode)} image={a.cover} title={a.title} sub={[a.day, a.date].filter(Boolean).join(' • ')} badge={`Ep ${a.episode}`} />)}
        </Shelf>
      )}

      {h && (
        <>
          <Shelf title="Lagi rame hari ini" more="/stream/anime">{h.trending.map((a) => <PosterCard key={a.id} to={routes.anime(a.id)} image={a.cover} title={a.title} sub={sub(a)} badge={a.type} />)}</Shelf>
          <Shelf title="Populer minggu ini" more="/stream/anime">{h.weekly.map((a, i) => <PosterCard key={a.id} to={routes.anime(a.id)} image={a.cover} title={a.title} sub={sub(a)} badge={`#${i + 1}`} />)}</Shelf>
        </>
      )}

      {(dh.data?.latest.length ?? 0) > 0 && (
        <Shelf title="Donghua terbaru" more="/stream/donghua">
          {dh.data!.latest.map((a) => <PosterCard key={a.id} to={routes.watch(a.episodeId!)} image={a.cover} title={a.title} sub="Donghua" badge={`Ep ${a.episode}`} />)}
        </Shelf>
      )}

      {m ? (
        <>
          {m.popular.length > 0 && <Shelf title="Komik populer" more="/stream/komik">{m.popular.map((x) => <PosterCard key={x.id} kind="manga" to={routes.manga(x.id)} image={x.cover} title={x.title} sub={x.source} badge={x.type ?? null} badgeR={x.latest ? `Ch ${x.latest}` : null} />)}</Shelf>}
          {m.latest.length > 0 && <Shelf title="Komik baru update" more="/stream/komik?order=latest">{m.latest.map((x) => <PosterCard key={x.id} kind="manga" to={routes.manga(x.id)} image={x.cover} title={x.title} sub={x.source} badge={x.type ?? null} badgeR={x.latest ? `Ch ${x.latest}` : null} />)}</Shelf>}
          {m.manhwa.length > 0 && <Shelf title="Manhwa pilihan" more="/stream/komik?type=manhwa">{m.manhwa.map((x) => <PosterCard key={x.id} kind="manga" to={routes.manga(x.id)} image={x.cover} title={x.title} sub={x.source} badge="Manhwa" />)}</Shelf>}
          {m.webtoons.length > 0 && <Shelf title="Tren WEBTOON" more="/stream/komik?src=wt">{m.webtoons.map((x) => <PosterCard key={x.id} kind="manga" to={routes.manga(x.id)} image={x.cover} title={x.title} sub="WEBTOON" />)}</Shelf>}
        </>
      ) : manga.error ? null : <ShelfSkeleton />}

      {h && (
        <>
          <Shelf title="Sedang tayang" more="/stream/anime?status=ongoing">{h.ongoing.map((a) => <PosterCard key={a.id} to={routes.anime(a.id)} image={a.cover} title={a.title} sub={sub(a)} badge={a.type} />)}</Shelf>
          <Shelf title="Film anime" more="/stream/anime?type=movie">{h.movies.map((a) => <PosterCard key={a.id} to={routes.anime(a.id)} image={a.cover} title={a.title} sub={sub(a)} badge="Movie" />)}</Shelf>
          <Shelf title="Populer sepanjang masa" more="/stream/anime">{h.allTime.map((a) => <PosterCard key={a.id} to={routes.anime(a.id)} image={a.cover} title={a.title} sub={sub(a)} badgeR={a.rating ? `Skor ${a.rating}` : null} />)}</Shelf>
          <Shelf title="Sudah tamat" more="/stream/anime?status=completed">{h.completed.map((a) => <PosterCard key={a.id} to={routes.anime(a.id)} image={a.cover} title={a.title} sub={sub(a)} />)}</Shelf>
          {(h.od?.completed.length ?? 0) > 0 && <Shelf title="Baru tamat di Otakudesu" more="/stream/anime?src=od&status=completed">{h.od!.completed.map((a) => <PosterCard key={a.id} to={routes.anime(a.id)} image={a.cover} title={a.title} sub={`${a.episode} episode`} badgeR={a.rating ? `Skor ${a.rating}` : null} />)}</Shelf>}
        </>
      )}
      {m && m.english.length > 0 && <Shelf title="Manga bahasa Inggris" more="/stream/komik?src=kk">{m.english.map((x) => <PosterCard key={x.id} kind="manga" to={routes.manga(x.id)} image={x.cover} title={x.title} sub={x.source} />)}</Shelf>}

      <p className="sub" style={{ marginTop: 36, textAlign: 'center' }}>
        Konten diambil dari sumber publik pihak ketiga. Freease tidak menyimpan video atau gambar.{' '}
        <Link to="/music" className="more" style={{ color: 'var(--a)', fontWeight: 700 }}>Pindah ke Freease Musik</Link>
      </p>
    </div>
  );
}
