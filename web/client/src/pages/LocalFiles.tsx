import { useRef, useState } from 'react';
import { FolderOpen, HardDrive } from 'lucide-react';
import { addLocalFiles, play } from '../player/player';
import type { Song } from '../lib/types';
import { Empty, SongRow } from '../components/ui';
import { useUi } from '../components/uiState';

let session: Song[] = [];

/** Putar berkas audio/video dari perangkat (tidak diunggah — diputar langsung di browser). */
export default function LocalFiles() {
  const [songs, setSongs] = useState<Song[]>(session);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const set = useUi((s) => s.set);
  const add = (files: FileList | null) => {
    if (!files) return;
    const added = addLocalFiles([...files]);
    session = [...session, ...added.filter((a) => !session.some((s) => s.id === a.id))];
    setSongs(session);
    if (added.length) {
      play(added, 0, 'Berkas di perangkat');
      if (added.some((s) => /\.(mp4|mkv|webm|mov|3gp)$/i.test(s.id.split(':')[1] || ''))) set({ nowPlaying: true });
    }
  };
  return (
    <div className="page">
      <div className="h1">Musik & video di perangkat</div>
      <div
        className={`drop-zone ${over ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
      >
        <HardDrive size={36} style={{ marginBottom: 8 }} />
        <div className="title" style={{ color: 'var(--text)' }}>Seret berkas ke sini, atau</div>
        <div className="actions" style={{ justifyContent: 'center' }}>
          <button className="btn primary" onClick={() => input.current?.click()}><FolderOpen size={18} />Pilih berkas</button>
        </div>
        <div className="sub">MP3, M4A, AAC, FLAC, OGG/Opus, WAV, MP4, MKV, WEBM… Berkas diputar langsung di browser, tidak diunggah ke server.</div>
        <input ref={input} type="file" accept="audio/*,video/*,.mkv,.flac,.opus" multiple hidden onChange={(e) => add(e.target.files)} />
      </div>
      {songs.length > 0 ? (
        <>
          <div className="h2">Dibuka di sesi ini</div>
          {songs.map((s, i) => <SongRow key={s.id} song={s} onPlay={() => play(songs, i, 'Berkas di perangkat')} />)}
        </>
      ) : <Empty icon={null} title="" sub="Catatan: browser tidak bisa membaca seluruh isi HP otomatis — pilih berkasnya dulu (bisa banyak sekaligus)." />}
    </div>
  );
}
