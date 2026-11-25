// Koleksi Stream: lanjutkan, anime & komik tersimpan, cadangan (pindah ke browser/HP lain).
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, DownloadCloud, History, Trash2, UploadCloud, X } from 'lucide-react';
import { toast } from '../../lib/toast';
import { ago, routes } from '../api';
import { clearAll, exportStream, favs, forget, importStream, recent, useStore } from '../store';
import { EpisodeCard, PosterCard, useTitle } from '../ui';

type Tab = 'lanjut' | 'anime' | 'komik';

export default function StreamLibrary() {
  useTitle('Koleksi');
  const [tab, setTab] = useState<Tab>('lanjut');
  const items = useStore(() => recent(undefined, 200), []);
  const anime = useStore(() => favs('anime'), []);
  const manga = useStore(() => favs('manga'), []);
  const file = useRef<HTMLInputElement>(null);

  const backup = async () => {
    const blob = new Blob([await exportStream()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `freease-stream-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div className="page">
      <div className="h1">Koleksi</div>
      <div className="chips">
        <button className={`chip ${tab === 'lanjut' ? 'on' : ''}`} onClick={() => setTab('lanjut')}><History size={14} style={{ verticalAlign: -2 }} /> Lanjutkan · {items.length}</button>
        <button className={`chip ${tab === 'anime' ? 'on' : ''}`} onClick={() => setTab('anime')}>Anime tersimpan · {anime.length}</button>
        <button className={`chip ${tab === 'komik' ? 'on' : ''}`} onClick={() => setTab('komik')}>Komik tersimpan · {manga.length}</button>
      </div>

      {tab === 'lanjut' && (items.length === 0 ? (
        <div className="empty"><History size={44} /><div className="title">Belum ada riwayat</div>Anime yang kamu tonton dan komik yang kamu baca muncul di sini.<Link className="btn primary" to="/stream">Jelajahi</Link></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 18 }}>
          {items.map((p) => (
            <div key={p.key} style={{ position: 'relative' }}>
              <EpisodeCard to={p.kind === 'anime' ? routes.watch(p.itemId) : routes.read(p.id, p.itemId)} image={p.cover} title={p.title} ep={p.itemLabel} badge={`${p.kind === 'anime' ? 'Anime' : 'Komik'} · ${ago(p.updatedAt)}`}
                progress={p.kind === 'anime' ? (p.dur ? p.pos / p.dur : 0) : p.pages ? ((p.page ?? 0) + 1) / p.pages : 0} />
              <button className="card-remove" style={{ position: 'absolute', right: 6, top: 6, zIndex: 3 }} aria-label="Hapus dari riwayat" onClick={() => void forget(p.kind, p.id)}><X size={14} /></button>
            </div>
          ))}
        </div>
      ))}

      {tab !== 'lanjut' && ((tab === 'anime' ? anime : manga).length === 0 ? (
        <div className="empty"><Bookmark size={44} /><div className="title">Belum ada yang disimpan</div>Tekan “Simpan” di halaman {tab === 'anime' ? 'anime' : 'komik'} untuk menaruhnya di sini.</div>
      ) : (
        <div className="grid-posters">
          {(tab === 'anime' ? anime : manga).map((f) => <PosterCard key={f.key} kind={f.kind} to={f.kind === 'anime' ? routes.anime(f.id) : routes.manga(f.id)} image={f.cover} title={f.title} sub={f.sub ?? undefined} />)}
        </div>
      ))}

      <div className="set-group" style={{ marginTop: 40 }}>Cadangan Stream</div>
      <div className="sub" style={{ marginBottom: 12 }}>Koleksi & riwayat Stream disimpan di browser ini saja. Simpan cadangan untuk dipindah ke perangkat lain.</div>
      <div className="actions">
        <button className="btn" onClick={() => void backup()}><DownloadCloud size={16} />Simpan cadangan</button>
        <button className="btn" onClick={() => file.current?.click()}><UploadCloud size={16} />Pulihkan</button>
        <button className="btn outline" onClick={async () => { if (confirm('Hapus semua koleksi & riwayat Freease Stream di browser ini?')) { await clearAll(); toast('Koleksi Stream dikosongkan'); } }}><Trash2 size={16} />Kosongkan</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try { toast(`${await importStream(await f.text())} entri dipulihkan`); } catch (x) { toast((x as Error).message); }
        }} />
      </div>
    </div>
  );
}
