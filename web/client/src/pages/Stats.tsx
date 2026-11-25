import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3 } from 'lucide-react';
import { art } from '../lib/api';
import * as db from '../lib/db';
import { useLibrary } from '../lib/hooks';
import { play } from '../player/player';
import { Artwork, Empty } from '../components/ui';

const RANGES = [
  { label: '7 hari', days: 7 },
  { label: '30 hari', days: 30 },
  { label: 'Tahun ini', days: -1 },
  { label: 'Semua', days: 0 },
];
const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const DAYS_FULL = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

function Bars({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(1, ...values);
  const peak = values.indexOf(Math.max(...values));
  return (
    <div className="bars-chart" role="img" aria-label="Grafik">
      {values.map((v, i) => (
        <div key={i} className={`b ${i === peak && v > 0 ? 'peak' : ''}`} title={`${labels[i] || i}: ${Math.round(v / 60000)} menit`}>
          <i style={{ height: `${(v / max) * 100}%` }} />
          <span>{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

export default function Stats() {
  const [range, setRange] = useState(1);
  const r = RANGES[range];
  const since = r.days > 0 ? Date.now() - r.days * 86400_000 : r.days === -1 ? new Date(new Date().getFullYear(), 0, 1).getTime() : 0;
  const s = useLibrary(() => db.topStats(since), null, [since]);
  if (!s) return <div className="page" />;
  const perHour = Array(24).fill(0);
  const perDay = Array(7).fill(0);
  const last7 = Array(7).fill(0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (const e of s.events) {
    const d = new Date(e.timestamp);
    perHour[d.getHours()] += e.playedMs;
    perDay[d.getDay()] += e.playedMs;
    const ago = Math.floor((today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400_000);
    if (ago >= 0 && ago < 7) last7[6 - ago] += e.playedMs;
  }
  const last7Labels = Array.from({ length: 7 }, (_, i) => DAYS[new Date(today.getTime() - (6 - i) * 86400_000).getDay()]);
  const peakHour = perHour.indexOf(Math.max(...perHour));
  const peakDay = perDay.indexOf(Math.max(...perDay));
  const when = peakHour >= 4 && peakHour <= 10 ? 'pagi' : peakHour <= 14 ? 'siang' : peakHour <= 17 ? 'sore' : peakHour <= 21 ? 'malam' : 'tengah malam';
  // Lagu yang sering dilewati: diputar < 45 detik padahal lagunya > 2 menit.
  const skipCount = new Map<string, number>();
  for (const e of s.events) if (e.playedMs < 45_000) skipCount.set(e.songId, (skipCount.get(e.songId) || 0) + 1);
  const skipped = s.songs.filter((x) => (skipCount.get(x.song.id) || 0) >= 2 && x.song.duration > 120).sort((a, b) => (skipCount.get(b.song.id) || 0) - (skipCount.get(a.song.id) || 0)).slice(0, 8);

  return (
    <div className="page">
      <div className="h1">Rekap kamu</div>
      <div className="chips">{RANGES.map((x, i) => <button key={x.label} className={`chip ${range === i ? 'on' : ''}`} onClick={() => setRange(i)}>{x.label}</button>)}</div>
      {s.totalMs === 0 ? (
        <Empty icon={<BarChart3 size={40} />} title="Belum ada data" sub="Putar beberapa lagu, rekapmu akan muncul di sini." />
      ) : (
        <>
          <div className="stat-big">{Math.round(s.totalMs / 60000).toLocaleString('id')}</div>
          <div className="sub" style={{ fontSize: 15 }}>menit mendengarkan • {s.songs.length} lagu berbeda • {s.artists.length} artis</div>

          <div className="h2">Menit per hari • 7 hari terakhir</div>
          <Bars values={last7} labels={last7Labels} />

          <div className="h2">Jam favorit</div>
          <div className="sub" style={{ marginTop: -6, marginBottom: 6 }}>Paling sering dengar jam {String(peakHour).padStart(2, '0')}.00 — kamu pendengar {when}</div>
          <Bars values={perHour} labels={perHour.map((_, h) => (h % 6 === 0 ? String(h).padStart(2, '0') : ''))} />

          <div className="h2">Hari favorit</div>
          <div className="sub" style={{ marginTop: -6, marginBottom: 6 }}>Paling banyak dengar musik di hari {DAYS_FULL[peakDay]}</div>
          <Bars values={perDay} labels={DAYS} />

          <div className="h2">Artis teratas</div>
          {s.artists.slice(0, 5).map((a, i) => (
            <Link key={a.artist} to={a.artistId ? `/artist/${a.artistId}` : '#'} className="rank">
              <div className="n">{i + 1}</div>
              <Artwork src={art(a.sample)} round style={{ width: 52, height: 52 }} />
              <div style={{ minWidth: 0 }}><div className="title ellipsis">{a.artist}</div><div className="sub">{Math.round(a.ms / 60000)} menit • {a.plays}× diputar</div></div>
            </Link>
          ))}

          <div className="h2">Lagu teratas <button className="more" onClick={() => play(s.songs.slice(0, 50).map((x) => x.song), 0, 'Lagu teratas kamu')}>Putar semua</button></div>
          {s.songs.slice(0, 10).map((x, i) => (
            <div key={x.song.id} className="rank" style={{ cursor: 'pointer' }} onClick={() => play(s.songs.slice(0, 50).map((y) => y.song), i, 'Lagu teratas kamu')}>
              <div className="n">{i + 1}</div>
              <Artwork src={art(x.song)} style={{ width: 52, height: 52, borderRadius: 6 }} />
              <div style={{ minWidth: 0 }}><div className="title ellipsis">{x.song.title}</div><div className="sub ellipsis">{x.song.artist} • {x.plays}× • {Math.round(x.ms / 60000)} mnt</div></div>
            </div>
          ))}

          {skipped.length > 0 && (
            <>
              <div className="h2">Paling sering dilewati</div>
              {skipped.map((x) => (
                <div key={x.song.id} className="rank" style={{ gridTemplateColumns: '52px 1fr' }}>
                  <Artwork src={art(x.song)} style={{ width: 52, height: 52, borderRadius: 6 }} />
                  <div style={{ minWidth: 0 }}><div className="title ellipsis">{x.song.title}</div><div className="sub">{x.song.artist} • dilewati {skipCount.get(x.song.id)}×</div></div>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}
