// Pemahaman perintah suara bahasa Indonesia — port dari VoiceParser app Android (aturan yang sama).

export type Page =
  | 'home' | 'search' | 'library' | 'liked' | 'downloads' | 'karaoke' | 'local' | 'history' | 'stats'
  | 'settings' | 'equalizer' | 'player' | 'queue';

export const PAGE_LABEL: Record<Page, string> = {
  home: 'Beranda', search: 'Cari', library: 'Koleksi', liked: 'Lagu yang Disukai', downloads: 'Unduhan',
  karaoke: 'Mode Karaoke', local: 'Musik & video di perangkat', history: 'Riwayat putar', stats: 'Statistik',
  settings: 'Pengaturan', equalizer: 'Equalizer', player: 'Pemutar', queue: 'Antrean',
};

export const MOODS = {
  STUDY: { label: 'belajar', words: 'belajar|fokus|kerja|ngoding|konsentrasi|nugas|tugas', query: 'lagu fokus belajar lofi instrumental' },
  SAD: { label: 'galau', words: 'galau|sedih|patah hati|nangis|mellow|melow|baper', query: 'lagu galau indonesia' },
  WORKOUT: { label: 'olahraga', words: 'olahraga|gym|lari|workout|fitness|semangat|nge-?gym|jogging', query: 'lagu semangat workout' },
  SLEEP: { label: 'tidur', words: 'tidur|istirahat|rebahan|bobo|nina bobo', query: 'musik tidur relaksasi tenang' },
  CHILL: { label: 'santai', words: 'santai|chill|kalem|ngopi|nyantai|selow', query: 'lagu santai indonesia chill akustik' },
  ROMANCE: { label: 'romantis', words: 'romantis|cinta|bucin|pacar|jatuh cinta|kasmaran', query: 'lagu romantis indonesia' },
  PARTY: { label: 'pesta', words: 'pesta|party|joget|goyang|dance|ajep|dugem', query: 'lagu party dance hits' },
  DRIVE: { label: 'perjalanan', words: 'nyetir|perjalanan|road trip|mudik|jalan[- ]jalan|touring|di jalan', query: 'lagu perjalanan road trip indonesia' },
  HAPPY: { label: 'ceria', words: 'ceria|happy|senang|bahagia|gembira|riang', query: 'lagu ceria happy' },
  RELIGI: { label: 'religi', words: 'religi|ngaji|sholawat|shalawat|islami|rohani', query: 'lagu religi islami' },
} as const;
export type MoodKind = keyof typeof MOODS;

export type Command =
  | { type: 'play'; query: string }
  | { type: 'search'; query: string }
  | { type: 'playPlaylist'; name: string }
  | { type: 'playLiked' }
  | { type: 'playDownloads' }
  | { type: 'next' } | { type: 'previous' } | { type: 'pause' } | { type: 'resume' } | { type: 'like' }
  | { type: 'shuffle'; on: boolean | null }
  | { type: 'repeat' }
  | { type: 'karaoke'; on: boolean }
  | { type: 'lyrics' }
  | { type: 'sleep'; minutes: number }
  | { type: 'cancelSleep' }
  | { type: 'whatsPlaying' }
  | { type: 'volume'; up: boolean }
  | { type: 'help' }
  | { type: 'open'; page: Page }
  | { type: 'openPlaylist'; name: string }
  | { type: 'openArtist'; name: string }
  | { type: 'back' }
  | { type: 'more' }
  | { type: 'again' }
  | { type: 'mood'; mood: MoodKind }
  | { type: 'summary'; days: number };

const FILLER = /\b(tolong|coba|dong|deh|ya|yah|yuk|ayo|please|hei|hai|halo|hallo|oke|okay|ok|freease|frease|frees|freeze|fries|fris|friis|freez|asisten|aku mau|saya mau|aku ingin|saya ingin|bisa|minta|sekarang)\b/g;
const NUMBER_WORDS: Record<string, number> = {
  satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9, sepuluh: 10,
  'lima belas': 15, 'dua puluh': 20, 'tiga puluh': 30, 'empat puluh': 40, 'empat puluh lima': 45, 'enam puluh': 60, setengah: 30,
};
const OPEN_VERB = '(?:buka(?:kan|in)?|pergi(?: ke)?|ke|masuk(?: ke)?|tampilkan|tunjukkan|lihat(?:in)?|liat(?:in)?|menuju(?: ke)?|pindah(?: ke)?|kembali ke|balik ke|open|go to|show|cek|check)';

const PAGES: [Page, RegExp][] = ([
  ['karaoke', '(lagu[- ]?lagu |lagu |musik |hasil |daftar |koleksi )karaoke( yang)?( (sudah|udah|telah))?( (tersimpan|disimpan|di ?simpan|di ?download|diunduh|di ?unduh|offline))?|karaoke( yang)?( (sudah|udah|telah))? (tersimpan|disimpan|di ?simpan|di ?download|diunduh|di ?unduh|offline)'],
  ['downloads', '(hasil |daftar |halaman )?(lagu[- ]?lagu |lagu |musik )?(yang )?((sudah|udah|telah) )?(di ?download|di ?unduh|unduhan|download(an)?|offline)'],
  ['liked', '(lagu[- ]?lagu |lagu |daftar )?(yang )?(di ?suka(i)?|favorit|kesukaan|liked( songs)?)'],
  ['local', '((musik|lagu|video|file|berkas)( dan video| & video)?( yang)?( ada)? di (hp|handphone|ponsel|memori|penyimpanan|perangkat|laptop|komputer)|musik lokal|lagu lokal|video lokal|file musik|berkas musik)'],
  ['stats', '(rekap|ringkasan|statistik|monthly)( freease)? (bulanan|bulan ini|per bulan|tahunan|tahun ini)|monthly( freease)?|rekap( bulanan| tahunan)?|wrapped|(statistik|stats|stat)( saya| dengar(an)?| mendengarkan)?'],
  ['history', '(riwayat|histori|history)( putar| lagu| dengar(an)?)?|lagu yang (pernah|barusan|tadi) (di ?putar|di ?dengar)'],
  ['equalizer', '(equalizer|ekualiser|ekualizer|eq|equaliser|pengatur suara)'],
  ['settings', '(pengaturan|setelan|settings?|setting(an)?|konfigurasi)( aplikasi| freease)?'],
  ['queue', '(antrean|antrian|queue|daftar putar( berikutnya)?|lagu (berikutnya|selanjutnya) apa saja)'],
  ['player', '(pemutar|player|now playing|lagu yang (sedang|lagi) (di ?putar|main))'],
  ['search', '(pencarian|cari|search|halaman cari)'],
  ['library', '(koleksi|library|perpustakaan|pustaka|playlist saya|playlist ku|playlistku)'],
  ['home', '(beranda|home|halaman (utama|depan|awal)|menu utama|depan|awal)'],
] as [Page, string][]).map(([p, re]) => [p, new RegExp(`^(?:halaman |menu |tab |bagian |page |layar )?(?:${re})(?:nya|ku| saya| aku| gua| gue)?$`)]);

const clean = (s: string) => s.replace(/\s+(di|pakai|lewat|dengan)( freease)?$/, '').trim();

export function sleepMinutes(t: string): number | null {
  if (!/(timer|tidur|matikan|berhenti|stop)/.test(t)) return null;
  const words = Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).join('|');
  const m = new RegExp(`(\\d+|${words}) ?(menit|jam|min)`).exec(t);
  if (!m) return null;
  const n = Number(m[1]) || NUMBER_WORDS[m[1]];
  if (!n) return null;
  const minutes = m[2] === 'jam' ? n * 60 : n;
  return minutes >= 1 && minutes <= 600 ? minutes : null;
}

function parseOpen(t: string): Command | null {
  if (/^(kembali|balik|mundur|back)( lagi)?$/.test(t)) return { type: 'back' };
  const m = new RegExp(`^${OPEN_VERB}\\s+(.+)$`).exec(t);
  const target = (m?.[1] ?? t).trim();
  if (m) {
    const pl = /^playlist (.+)$/.exec(target);
    if (pl) return { type: 'openPlaylist', name: clean(pl[1]) };
    const ar = /^(?:halaman |profil )?(?:artis|penyanyi|band|channel) (.+)$/.exec(target);
    if (ar) return { type: 'openArtist', name: clean(ar[1]) };
  }
  const page = PAGES.find(([, re]) => re.test(target))?.[0];
  if (!page) return null;
  if (!m && (page === 'downloads' || page === 'liked')) return null;
  return { type: 'open', page };
}

/** [preferPlay]: dipanggil lewat "Oke Freease" — kalimat tanpa kata kerja ("Tulus") dianggap minta diputar. */
export function parse(raw: string, preferPlay = false): Command | null {
  let t = raw.toLowerCase().replace(/[.,!?]/g, ' ');
  t = t.replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const has = (...res: string[]) => res.some((r) => new RegExp(r).test(t));

  if (has('^(tampilkan|buka|lihat|munculkan)? ?lirik(nya)?( lagu( ini)?)?$')) return { type: 'lyrics' };
  const open = parseOpen(t);
  if (open) return open;

  if (has('^(lagu )?(selanjutnya|berikutnya)$', '^(next|skip)( lagu| song)?$', '^(lewati|lewatin|ganti)( lagu(nya)?( ini)?)?$', 'lagu (selanjutnya|berikutnya)$')) return { type: 'next' };
  if (has('^(lagu )?sebelumnya$', '^previous( song)?$', 'lagu sebelumnya', '^kembali( ke)? lagu sebelumnya$')) return { type: 'previous' };
  if (has('^(jeda|pause|stop|berhenti|hentikan|diam|matikan musik(nya)?)( lagu(nya)?| musik(nya)?)?$')) return { type: 'pause' };
  if (has('^(lanjutkan|lanjut|resume|play|putar lagi|mainkan lagi|lanjutin)( lagu(nya)?| musik(nya)?)?$')) return { type: 'resume' };
  if (has('^(suka|like|sukai|love)( lagu( ini)?| this song)?$', 'tambah(kan)? ke (lagu yang )?disukai', 'simpan lagu ini')) return { type: 'like' };
  if (has('(matikan|nonaktifkan|stop) (mode )?(acak|shuffle)')) return { type: 'shuffle', on: false };
  if (has('^(acak|shuffle)( lagu(nya)?)?$', '(nyalakan|aktifkan|hidupkan) (mode )?(acak|shuffle)')) return { type: 'shuffle', on: true };
  if (has('^(ulangi|repeat)( lagu( ini)?)?$')) return { type: 'repeat' };
  if (has('(matikan|nonaktifkan|stop) (mode )?karaoke')) return { type: 'karaoke', on: false };
  if (has('karaoke')) return { type: 'karaoke', on: true };
  if (has('(batalkan|matikan) (timer|pengatur waktu) tidur')) return { type: 'cancelSleep' };
  const sm = sleepMinutes(t);
  if (sm) return { type: 'sleep', minutes: sm };
  if (has('lagu apa (yang )?(sedang |lagi )?(di ?putar|main)', '(ini|sekarang) lagu apa', 'judul lagu ini', 'siapa (penyanyi|yang nyanyi)', 'lagu apa ini')) return { type: 'whatsPlaying' };
  if (has('^(keraskan|kerasin|naikkan|naikin|besarkan|gedein)( volume(nya)?| suara(nya)?)?$', 'volume (naik|up)', 'lebih keras')) return { type: 'volume', up: true };
  if (has('^(kecilkan|kecilin|pelankan|turunkan|turunin)( volume(nya)?| suara(nya)?)?$', 'volume (turun|down)', 'lebih pelan')) return { type: 'volume', up: false };
  if (has('^(bantuan|help|bisa apa( saja)?|apa (saja )?yang bisa)', '^(kamu )?apa saja$', '^(kamu )?(bisa )?ngapain( saja)?$')) return { type: 'help' };

  if (has('^(yang|lagu|musik)? ?(lain(nya)?|berbeda|beda)( dong| lagi)?$', '^(ganti|cari(in)?|putar(in)?|kasih) (yang|lagu) lain(nya)?', '^another( one| song)?$', '^lagu lain( lagi)?$')) return { type: 'more' };
  if (has('^(putar(in)?|setel|mainkan)? ?(lagu )?yang tadi( lagi)?$', '^(lagu )?(yang )?tadi lagi$', '^ulang(i)? (lagu )?yang tadi$')) return { type: 'again' };
  if (has('(dengar(in|kan)?|dengerin|denger|putar|play) apa (aja|saja)', 'rangkuman|ringkasan|rekap (hari|minggu)', 'berapa lama (aku |saya |gua |gue )?(dengar|dengerin|denger)')) {
    return { type: 'summary', days: has('minggu|pekan|7 hari|seminggu') ? 7 : has('bulan') ? 30 : 1 };
  }
  {
    const body = t.replace(/^(putar(kan|in)?|mainkan|setel|play|dengarkan|kasih|cariin|carikan)\s+/, '');
    if (!body.startsWith('playlist ')) {
      const framed = /^((lagu|musik|playlist)([- ]lagu)? (yang )?(cocok )?(buat|untuk|pas|waktu|saat|biar|yang)\b|(yang|lagu yang|musik yang) (lebih|agak) )/.test(body);
      const entries = Object.entries(MOODS) as [MoodKind, (typeof MOODS)[MoodKind]][];
      if (framed) {
        const f = entries.find(([, m]) => new RegExp(`\\b(${m.words})\\b`).test(body));
        if (f) return { type: 'mood', mood: f[0] };
      }
      const bare = body.replace(/^(lagu|musik|playlist)([- ]lagu)? /, '').replace(/ (banget|dong|aja|nih|deh)$/, '').trim();
      const b = entries.find(([, m]) => new RegExp(`^(${m.words})$`).test(bare));
      if (b) return { type: 'mood', mood: b[0] };
    }
  }

  const search = /^(?:cari(?:kan)?|search|temukan)\s+(.+)$/.exec(t);
  if (search) return { type: 'search', query: clean(search[1]) };

  const play = /^(?:putar(?:kan|in)?|mainkan|setel|play|dengarkan|nyalakan)\s+(.+)$/.exec(t);
  const target = play?.[1] ?? t;
  if (/^(lagu[- ]?lagu |lagu )?(yang )?(di)?(suka(i)?|favorit(ku| saya)?|kesukaan(ku| saya)?)$/.test(target) || target === 'liked songs') return { type: 'playLiked' };
  if (/^(lagu[- ]?lagu |lagu )?(yang )?(sudah |udah |telah )?(di ?unduh|di ?download|unduhan|download(an)?|offline)/.test(target)) return { type: 'playDownloads' };
  const pl = /^playlist (.+)$/.exec(target);
  if (pl) return { type: 'playPlaylist', name: clean(pl[1]) };
  const q = clean(target.replace(/^(lagu[- ]?lagu|lagu(nya)?|musik) (dari |dari penyanyi |oleh )?/, ''));
  if (!q) return { type: 'resume' };
  return play || preferPlay ? { type: 'play', query: q } : { type: 'search', query: q };
}
