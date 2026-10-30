import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { clearHistory, clearLyrics, wipeEverything } from '../lib/db';
import { exportBackup, importBackup } from '../lib/backup';
import { ACCENTS, EQ_FREQS, EQ_PRESETS, useSettings } from '../lib/settings';
import { toast } from '../lib/toast';
import { usePlayer, setKaraoke } from '../player/player';
import { floatingSupported, toggleFloatingLyrics, useLiveLyrics } from '../player/liveLyrics';
import { Switch } from '../components/ui';

function Row({ title, sub, children, onClick }: { title: string; sub?: string; children?: React.ReactNode; onClick?: () => void }) {
  return (
    <div className="set-row" onClick={onClick} style={{ cursor: onClick ? 'pointer' : undefined }}>
      <div className="txt"><div className="title" style={{ fontWeight: 600 }}>{title}</div>{sub && <div className="sub">{sub}</div>}</div>
      {children}
    </div>
  );
}

export default function Settings() {
  const s = useSettings();
  const nav = useNavigate();
  const karaoke = usePlayer((p) => p.karaoke);
  const floating = useLiveLyrics((l) => l.floating);
  const file = useRef<HTMLInputElement>(null);
  const preset = Object.entries(EQ_PRESETS).find(([, v]) => v.every((x, i) => x === s.eqBands[i]))?.[0];

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div className="h1">Pengaturan</div>

      <div className="set-group">Tampilan</div>
      <Row title="Warna aksen">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {ACCENTS.map((a, i) => <button key={a.name} title={a.name} aria-label={a.name} className={`swatch ${s.accent === i ? 'on' : ''}`} style={{ background: `linear-gradient(135deg,${a.a},${a.b})` }} onClick={() => s.set({ accent: i })} />)}
        </div>
      </Row>
      <Row title="Mode AMOLED (hitam pekat)" sub="Lebih hemat baterai di layar OLED"><Switch label="AMOLED" on={s.amoled} onChange={(v) => s.set({ amoled: v })} /></Row>

      <div className="set-group">Pemutaran</div>
      <Row title="Putar otomatis" sub="Lanjutkan dengan lagu serupa saat antrean habis"><Switch label="Putar otomatis" on={s.autoplay} onChange={(v) => s.set({ autoplay: v })} /></Row>
      <Row title="100% tanpa iklan" sub="Lagu & video diambil langsung sebagai file mentah lewat server Freease — tidak memakai player YouTube, jadi iklan YouTube tidak pernah tayang. Sponsor yang direkam di dalam video dilewati otomatis (SponsorBlock)." />
      <Row title="Tampilkan video" sub="Putar video klip (tanpa iklan) bersama audionya. Bisa juga diganti di layar Sedang Diputar: Lagu / Video"><Switch label="Tampilkan video" on={s.videoMode} onChange={(v) => s.set({ videoMode: v })} /></Row>
      <Row title="Kualitas video" sub={s.videoQuality ? `Maksimal ${s.videoQuality}p` : 'Otomatis: 720p di HP, 1080p di layar besar, 360p bila mode hemat data aktif'}>
        <select className="field" style={{ width: 170 }} value={s.videoQuality} onChange={(e) => s.set({ videoQuality: Number(e.target.value) })}>
          <option value={0}>Otomatis</option>
          {[360, 480, 720, 1080, 1440, 2160].map((h) => <option key={h} value={h}>{h >= 2160 ? '4K (2160p)' : h >= 1440 ? '2K (1440p)' : `${h}p`}</option>)}
        </select>
      </Row>
      <Row title="Kualitas audio" sub={s.audioQuality === 'high' ? 'Tinggi: kualitas terbaik dari YouTube (opus ±130–160 kbps)' : 'Hemat data: ±50 kbps (±1,5 MB per lagu)'}>
        <select className="field" style={{ width: 170 }} value={s.audioQuality} onChange={(e) => s.set({ audioQuality: e.target.value as 'high' | 'low' })}>
          <option value="high">Tinggi</option>
          <option value="low">Hemat data</option>
        </select>
      </Row>

      <div className="set-group">Equalizer & karaoke</div>
      <Row title="Equalizer" sub={s.eqEnabled ? `Preset: ${preset ?? 'Kustom'}` : 'Mati'}><Switch label="Equalizer" on={s.eqEnabled} onChange={(v) => s.set({ eqEnabled: v })} /></Row>
      {s.eqEnabled && (
        <div className="card-box" style={{ marginTop: 10 }}>
          <div className="chips" style={{ flexWrap: 'wrap' }}>
            {Object.keys(EQ_PRESETS).map((k) => <button key={k} className={`chip ${preset === k ? 'on' : ''}`} onClick={() => s.set({ eqBands: EQ_PRESETS[k] })}>{k}</button>)}
          </div>
          <div className="eq">
            {EQ_FREQS.map((f, i) => (
              <div className="band" key={f}>
                <span>{s.eqBands[i] > 0 ? '+' : ''}{s.eqBands[i]}</span>
                <input type="range" min={-12} max={12} step={1} value={s.eqBands[i]} aria-label={`${f} Hz`} onChange={(e) => { const b = [...s.eqBands]; b[i] = Number(e.target.value); s.set({ eqBands: b }); }} />
                <span>{f >= 1000 ? `${f / 1000}k` : f}</span>
              </div>
            ))}
          </div>
          <Row title={`Bass boost: +${s.bass} dB`} sub="Volume keseluruhan diturunkan otomatis supaya tidak pecah">
            <input type="range" min={0} max={12} value={s.bass} onChange={(e) => s.set({ bass: Number(e.target.value) })} aria-label="Bass boost" />
          </Row>
        </div>
      )}
      <Row title="Mode Karaoke (beta)" sub="Masih jauh dari sempurna: vokal hanya dikurangi dengan trik audio di browser (tanpa AI), jadi musik bisa terdengar aneh/tipis dan vokal kadang masih terdengar. Karaoke AI yang bersih ada di app Android."><Switch label="Mode Karaoke" on={karaoke} onChange={setKaraoke} /></Row>
      <Row title={`Vokal asli tersisa: ${s.karaokeVocal}%`} sub="Naikkan untuk nyanyi bareng vokal aslinya yang dipelankan">
        <input type="range" min={0} max={100} value={s.karaokeVocal} onChange={(e) => s.set({ karaokeVocal: Number(e.target.value) })} aria-label="Vokal asli" />
      </Row>

      <div className="set-group">Video YouTube</div>
      <Row title="Subtitle" sub={s.subtitleLang === 'id' ? 'Indonesia — diterjemahkan otomatis bila videonya berbahasa lain' : s.subtitleLang === 'orig' ? 'Bahasa asli video' : 'Mati (bisa dinyalakan dari tombol Subtitle di layar tonton)'}>
        <select className="field" style={{ width: 170 }} value={s.subtitleLang} onChange={(e) => s.set({ subtitleLang: e.target.value as '' | 'id' | 'orig' })}>
          <option value="">Mati</option>
          <option value="id">Indonesia</option>
          <option value="orig">Bahasa asli</option>
        </select>
      </Row>
      <Row title="Lanjutkan menonton" sub="Video & lagu panjang (≥ 10 menit) diputar lagi dari posisi terakhir; daftarnya ada di Beranda"><Switch label="Lanjutkan menonton" on={s.resumeLong} onChange={(v) => s.set({ resumeLong: v })} /></Row>

      <div className="set-group">Lirik</div>
      <Row title="Terjemahan lirik (Indonesia)" sub="Terjemahan tampil di bawah tiap baris lirik; disimpan di browser supaya tidak diterjemahkan ulang"><Switch label="Terjemahan lirik" on={s.lyricsTranslate} onChange={(v) => s.set({ lyricsTranslate: v })} /></Row>
      <Row title="Lirik di notifikasi & layar kunci" sub="Baris yang sedang dinyanyikan tampil di notifikasi musik HP dan layar kunci, menggantikan nama artis"><Switch label="Lirik di notifikasi" on={s.lyricsInNotification} onChange={(v) => s.set({ lyricsInNotification: v })} /></Row>
      <Row
        title={floating ? 'Tutup lirik melayang' : 'Buka lirik melayang'}
        sub={floatingSupported() ? 'Jendela kecil berisi lirik yang tetap tampil di atas aplikasi lain dan layar beranda. Tidak butuh izin khusus.' : 'Browser ini belum mendukung jendela melayang (pakai Chrome atau Edge terbaru)'}
        onClick={() => void toggleFloatingLyrics()}
      />

      <div className="set-group">Freease Smart</div>
      <Row title="Suara jawaban" sub={s.replyVoice === 'dev' ? 'Suara Dev (Kodok-Kejepit)' : s.replyVoice === 'tts' ? 'Suara browser' : 'Tanpa suara'}>
        <select className="field" style={{ width: 190 }} value={s.replyVoice} onChange={(e) => s.set({ replyVoice: e.target.value as 'dev' | 'tts' | 'off' })}>
          <option value="dev">Suara Dev (Kodok-Kejepit)</option>
          <option value="tts">Suara browser</option>
          <option value="off">Tanpa suara</option>
        </select>
      </Row>
      <Row title="“Oke Freease” tanpa tombol" sub="Dengarkan panggilan selama tab terbuka (Chrome/Edge). Mikrofon aktif terus — matikan kalau tidak dipakai.">
        <Switch label="Oke Freease" on={s.wakeWord} onChange={(v) => s.set({ wakeWord: v })} />
      </Row>

      <div className="set-group">Privasi</div>
      <Row title="Data kamu tersimpan di perangkat ini" sub="Riwayat, statistik, lagu disukai, playlist, unduhan, lirik offline, dan pengaturan disimpan di browser ini saja — tidak dikirim atau disimpan di server. Server hanya meneruskan lagu & lirik dan tidak mencatat apa yang kamu cari atau putar." />
      <Row title="Hapus riwayat putar & tontonan" sub="Daftar “baru diputar”, statistik & rekap ikut kosong; lagu disukai dan playlist tetap ada" onClick={async () => {
        if (!confirm('Hapus semua riwayat putar di browser ini?')) return;
        await clearHistory();
        toast('Riwayat putar dihapus');
      }} />
      <Row title="Hapus riwayat pencarian" sub="Kata kunci yang pernah dicari (bisa juga dihapus satu per satu di halaman Cari)" onClick={() => {
        localStorage.removeItem('freease-searches');
        toast('Riwayat pencarian dihapus');
      }} />
      <Row title="Hapus lirik tersimpan" sub="Lirik yang disimpan untuk dibaca offline & pengaturan geser waktu lirik" onClick={async () => {
        await clearLyrics();
        localStorage.removeItem('freease-lyrics-offset');
        toast('Lirik tersimpan dihapus');
      }} />
      <Row title="Hapus semua data di browser ini" sub="Koleksi, playlist, unduhan, riwayat, dan pengaturan dihapus total. Cadangkan dulu kalau masih perlu." onClick={async () => {
        if (!confirm('Hapus SEMUA data Freease di browser ini? Ini tidak bisa dibatalkan.')) return;
        await wipeEverything();
        location.reload();
      }} />

      <div className="set-group">Cadangan</div>
      <Row title="Cadangkan koleksi" sub="Playlist, lagu disukai, artis, dan riwayat — formatnya sama dengan app Freease Android" onClick={async () => {
        const blob = new Blob([await exportBackup()], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `freease-cadangan-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      }} />
      <Row title="Pulihkan dari cadangan" sub="Pilih berkas cadangan dari app Android atau web" onClick={() => file.current?.click()} />
      <input ref={file} type="file" accept="application/json,.json" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        try {
          const r = await importBackup(await f.text());
          toast(`Dipulihkan: ${r.liked} lagu disukai, ${r.playlists} playlist, ${r.artists} artis, ${r.plays} riwayat`);
        } catch (err) { toast((err as Error).message); }
      }} />

      <Row title="Pembuat: Kodok-Kejepit" sub="Profil, proyek lain (JRG & Freease OSINT Tool), dan cara mendukung" onClick={() => nav('/profile')} />
      <Row title="Tentang" sub="Freease Web 1.7.1 • pemutar musik pribadi tanpa iklan • by Kodok-Kejepit" />
    </div>
  );
}
