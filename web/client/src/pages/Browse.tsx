import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Download, Radio, UserCheck, UserPlus, ListPlus } from 'lucide-react';
import { api, art } from '../lib/api';
import * as db from '../lib/db';
import { useFetch, useLibrary } from '../lib/hooks';
import { toast } from '../lib/toast';
import { download, play } from '../player/player';
import { Collection } from '../components/Collection';
import { startRadio } from '../components/Menus';
import { Card, ErrorBox, Loading } from '../components/ui';
import { useUi } from '../components/uiState';

export function Artist() {
  const { id = '' } = useParams();
  const r = useFetch(() => api.artist(id), [id]);
  const following = useLibrary(() => db.isFollowing(id), false, [id]);
  if (r.error) return <div className="page"><ErrorBox error={r.error} retry={r.retry} /></div>;
  const a = r.data;
  return (
    <Collection
      title={a?.name || ' '}
      kind="Artis"
      round
      cover={a?.thumbnail}
      songs={a?.songs ?? []}
      from={a?.name || 'Artis'}
      loading={r.loading}
      actions={a && (
        <>
          <button className="btn outline sm" onClick={() => db.setFollow({ id, name: a.name, thumbnail: a.thumbnail }, !following).then(() => toast(following ? 'Berhenti mengikuti' : `Mengikuti ${a.name}`))}>
            {following ? <UserCheck size={16} /> : <UserPlus size={16} />}{following ? 'Diikuti' : 'Ikuti'}
          </button>
          {a.songs[0] && <button className="btn outline sm" onClick={() => startRadio(a.songs[0])}><Radio size={16} />Radio</button>}
        </>
      )}
    >
      {a?.description && <p className="sub" style={{ maxWidth: 760, marginTop: 0 }}>{a.description.slice(0, 280)}{a.description.length > 280 ? '…' : ''}</p>}
      {a?.releases?.length ? (
        <>
          <div className="h2">Rilisan</div>
          <div className="shelf" style={{ marginBottom: 12 }}>{a.releases.map((p) => <Card key={p.id} to={`/remote/${p.id}`} image={p.thumbnail} title={p.title} sub={p.subtitle} />)}</div>
          <div className="h2">Lagu</div>
        </>
      ) : null}
    </Collection>
  );
}

export function RemotePlaylist() {
  const { id = '' } = useParams();
  const r = useFetch(() => api.playlist(id), [id]);
  const set = useUi((s) => s.set);
  const nav = useNavigate();
  if (r.error) return <div className="page"><ErrorBox error={r.error} retry={r.retry} /></div>;
  const p = r.data;
  const album = id.startsWith('MPRE') || id.startsWith('OLAK');
  return (
    <Collection
      title={p?.title || ' '}
      kind={album ? 'Album' : 'Playlist'}
      subtitle={p?.subtitle}
      cover={p?.thumbnail || (p?.songs[0] ? art(p.songs[0], true) : null)}
      songs={p?.songs ?? []}
      from={p?.title || 'Playlist'}
      loading={r.loading}
      numbered={album}
      actions={p && p.songs.length > 0 && (
        <>
          <button className="btn outline sm" onClick={async () => { const n = await db.createPlaylist(p.title, p.songs); toast(`Disimpan ke Koleksi (${n.songs.length} lagu)`); nav(`/playlist/${n.id}`); }}><ListPlus size={16} />Simpan</button>
          <button className="btn outline sm" onClick={() => set({ addTo: p.songs })}>Tambah ke playlist…</button>
          <DownloadAll songs={p.songs} />
        </>
      )}
    />
  );
}

export function DownloadAll({ songs }: { songs: { id: string; title: string; artist: string; duration: number }[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <button className="btn outline sm" disabled={!!busy} onClick={async () => {
      const have = await db.downloadIds();
      const todo = songs.filter((s) => !have.has(s.id));
      let ok = 0;
      for (let i = 0; i < todo.length; i++) {
        setBusy(`${i + 1}/${todo.length}`);
        if (await download(todo[i] as any)) ok++;
      }
      setBusy(null);
      toast(todo.length ? `${ok} lagu siap didengar offline` : 'Semua lagu sudah diunduh');
    }}>
      <Download size={16} />{busy ? `Mengunduh ${busy}` : 'Unduh semua'}
    </button>
  );
}

/** Link lagu yang dibagikan (/song/:id) → langsung diputar. */
export function SharedSong() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const set = useUi((s) => s.set);
  useEffect(() => {
    api.song(id).then((s) => { play([s], 0, 'Link yang dibagikan'); set({ nowPlaying: true }); nav('/', { replace: true }); })
      .catch((e) => { toast(`Gagal membuka lagu: ${e.message}`); nav('/', { replace: true }); });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="page"><Loading /></div>;
}
