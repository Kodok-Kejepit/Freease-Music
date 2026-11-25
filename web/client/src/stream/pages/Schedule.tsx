// Jadwal rilis anime per hari (WIB). Hari ini terpilih otomatis.
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import { fs, routes } from '../api';
import { Failed, Img, Spinner, useLoad, useTitle } from '../ui';

const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const wib = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(+d) ? '' : d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
};

export default function Schedule() {
  useTitle('Jadwal rilis');
  const today = DAYS[new Date().getDay()];
  const [day, setDay] = useState(today);
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const kind = sp.get('kind') === 'donghua' ? 'donghua' : undefined;
  const { data, error, loading, retry } = useLoad((s) => fs.schedule(kind, s), [kind]);
  const cur = data?.find((d) => d.day === day);
  const items = [...(cur?.items ?? [])].sort((a, b) => wib(a.time).localeCompare(wib(b.time)));
  return (
    <div className="page">
      <div className="h1" style={{ display: 'flex', alignItems: 'center', gap: 10 }}><CalendarDays size={26} />Jadwal rilis</div>
      <div className="chips">
        <button className={`chip ${!kind ? 'on' : ''}`} onClick={() => setSp(new URLSearchParams(), { replace: true })}>Anime</button>
        <button className={`chip ${kind ? 'on' : ''}`} onClick={() => setSp(new URLSearchParams({ kind: 'donghua' }), { replace: true })}>Donghua</button>
      </div>
      <div className="day-tabs">
        {(data ?? DAYS.slice(1).concat('Minggu').map((d) => ({ day: d, items: [] }))).map((d) => (
          <button key={d.day} className={`chip ${d.day === day ? 'on' : ''}`} onClick={() => setDay(d.day)}>{d.day === today ? `${d.day} (hari ini)` : d.day}{d.items.length ? ` · ${d.items.length}` : ''}</button>
        ))}
      </div>
      {loading && !data ? <Spinner /> : error ? <Failed error={error} retry={retry} /> : items.length === 0 ? (
        <div className="empty"><div className="title">Tidak ada jadwal</div>Belum ada anime yang tercatat rilis hari {day}.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 4 }}>
          {items.map((it) => (
            <div key={it.id} className="sched-row" role="link" tabIndex={0} onClick={() => nav(routes.anime(it.id))} onKeyDown={(e) => e.key === 'Enter' && nav(routes.anime(it.id))}>
              <span className="tm">{wib(it.time) || '—'}</span>
              <div className="pcard" style={{ width: 56, flex: 'none', pointerEvents: 'none' }}><div className="pcover" style={{ borderRadius: 8 }}><Img src={it.cover} /></div></div>
              <div style={{ minWidth: 0 }}>
                <div className="title" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{it.title}</div>
                {(it.episode || it.source) && <div className="sub">{[it.episode && `Episode ${it.episode}`, it.source].filter(Boolean).join(' · ')}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="sub" style={{ marginTop: 20 }}>Waktu dalam WIB. Jadwal dari sumber dan bisa bergeser.</div>
    </div>
  );
}
