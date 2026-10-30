// Akses YouTube / YouTube Music lewat InnerTube (youtubei.js). Semua hasil dinormalisasi ke bentuk
// Song { id, title, artist, artistId, album, duration, thumbnail } yang dipakai klien.
import crypto from 'node:crypto';
import { Innertube, UniversalCache, Platform, Log } from 'youtubei.js';

// Peringatan parser youtubei.js (kelas baru di respons YouTube) tidak perlu memenuhi log server.
Log.setLevel(Log.Level.NONE);

// youtubei.js butuh evaluator JS untuk mendekripsi URL stream (cadangan bila yt-dlp tidak tersedia).
Platform.shim.eval = async (data, env) => {
  const props = [];
  if (env.n) props.push(`n: exportedVars.nFunction(${JSON.stringify(env.n)})`);
  if (env.sig) props.push(`sig: exportedVars.sigFunction(${JSON.stringify(env.sig)})`);
  return new Function(`${data.output}\nreturn { ${props.join(', ')} }`)();
};

let client = null;
let createdAt = 0;

/** Satu sesi InnerTube dipakai bersama; diperbarui tiap 6 jam (data pemain & visitor berganti). */
export async function yt() {
  if (!client || Date.now() - createdAt > 6 * 3600_000) {
    client = await Innertube.create({
      cache: new UniversalCache(false),
      lang: process.env.FREEASE_LANG || 'id',
      location: process.env.FREEASE_REGION || 'ID',
      retrieve_player: true,
    });
    createdAt = Date.now();
  }
  return client;
}

const text = (v) => (v == null ? '' : typeof v === 'string' ? v : v.toString?.() ?? '');

/** Thumbnail terbaik dari berbagai bentuk (array, MusicThumbnail, dsb.). */
function thumbOf(item) {
  const list =
    item?.thumbnail?.contents ?? item?.thumbnails ?? item?.thumbnail ?? item?.author?.thumbnails ?? [];
  const arr = Array.isArray(list) ? list : [];
  const best = [...arr].sort((a, b) => (b.width || 0) - (a.width || 0))[0];
  let url = best?.url || null;
  if (url?.startsWith('//')) url = 'https:' + url;
  return url;
}

function parseDuration(s) {
  if (!s) return 0;
  const p = String(s).split(':').map(Number);
  if (p.some(Number.isNaN)) return 0;
  return p.reduce((a, b) => a * 60 + b, 0);
}

const TYPE_WORDS = /^(lagu|song|video|single|ep|album|playlist|artis|artist|episode|podcast)$/i;

/** MusicResponsiveListItem → Song. Kolom ke-2 berbentuk "Lagu • Artis • Album • 3:45". */
export function mapMusicItem(it) {
  const id = it.id || it.video_id || it.endpoint?.payload?.videoId;
  if (!id) return null;
  const cols = (it.flex_columns || []).map((c) => c.title);
  const title = text(it.title) || text(cols[0]);
  const runs = cols[1]?.runs || [];
  const parts = text(cols[1]).split(' • ').map((s) => s.trim()).filter(Boolean);
  if (parts.length && TYPE_WORDS.test(parts[0])) parts.shift();
  const artistRun = runs.find((r) => r.endpoint?.payload?.browseId?.startsWith('UC'));
  const artist = it.artists?.map((a) => a.name).join(', ') || it.author?.name || text(artistRun?.text) || parts[0] || '';
  const artistId = it.artists?.[0]?.channel_id || it.author?.channel_id || artistRun?.endpoint?.payload?.browseId || null;
  const duration = it.duration?.seconds || parseDuration(parts.find((p) => /^\d+:\d{2}(:\d{2})?$/.test(p)));
  const album = it.album?.name || (parts.length >= 3 && !/ditonton|views|x /i.test(parts[1]) ? parts[1] : null);
  return { id, title, artist, artistId, album: album || null, duration, thumbnail: thumbOf(it) };
}

/** Video YouTube biasa → Song (judul "Artis - Judul (Official …)" dirapikan seperlunya). */
export function mapVideo(v) {
  const id = v.id || v.video_id;
  if (!id) return null;
  return {
    id,
    title: text(v.title),
    artist: v.author?.name || text(v.short_byline_text) || '',
    artistId: v.author?.id || null,
    album: null,
    duration: v.duration?.seconds || parseDuration(text(v.length_text)),
    thumbnail: thumbOf(v),
    // Info tambahan untuk tampilan ala YouTube (tab Video).
    views: text(v.short_view_count) || text(v.view_count) || null,
    published: text(v.published) || null,
    live: !!(v.is_live || v.badges?.some?.((b) => /live|langsung/i.test(text(b.label)))),
  };
}

/**
 * Hasil YouTube biasa (cadangan bila YouTube Music kosong) diurutkan supaya mirip hasil "lagu":
 * video resmi dulu, video lirik buatan kanal lain belakangan, kompilasi panjang dibuang.
 */
export function rankVideos(q, list, songsOnly) {
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const score = (s) => {
    const t = s.title.toLowerCase();
    const a = s.artist.toLowerCase();
    let v = 0;
    if (/official|resmi/.test(t)) v += 3;
    if (words.some((w) => a.includes(w))) v += 2;
    if (/ - topic$/.test(a)) v += 2;
    if (/lirik|lyric/.test(a)) v -= 3;
    if (/cover|karaoke|remix|reaction|tutorial|chord/.test(t)) v -= 2;
    if (/playlist|full album|kumpulan|nonstop|non stop|top hits|mix 20\d\d|\d+ lagu/.test(t)) v -= 6;
    return v;
  };
  const filtered = songsOnly ? list.filter((s) => !s.duration || s.duration <= 15 * 60) : list;
  return filtered.map((s, i) => ({ s, k: score(s) * 100 - i })).sort((x, y) => y.k - x.k).map((x) => x.s);
}

function collect(node, pred, out = [], depth = 0) {
  if (!node || depth > 8) return out;
  if (Array.isArray(node)) { node.forEach((n) => collect(n, pred, out, depth + 1)); return out; }
  if (typeof node !== 'object') return out;
  if (pred(node)) { out.push(node); return out; }
  for (const k of ['contents', 'items', 'results', 'sections']) if (node[k]) collect(node[k], pred, out, depth + 1);
  return out;
}

const isMusicItem = (n) => n.type === 'MusicResponsiveListItem' || n.type === 'MusicTwoRowItem';

function uniq(list) {
  const seen = new Set();
  return list.filter((s) => s && !seen.has(s.id) && seen.add(s.id));
}

// ---------------------------------------------------------------- pencarian bertingkat (scroll tanpa ujung)
// Lanjutan hasil YouTube terikat ke objek pencarian youtubei.js, jadi objeknya disimpan sebentar di memori
// dengan token acak. Klien meminta halaman berikut dengan token itu sampai YouTube kehabisan hasil.
const pages = new Map(); // token → { obj, map, seen, expires }
const PAGE_TTL = 15 * 60_000;
const MAX_PAGES = 60; // objek pencarian cukup besar → batasi supaya RAM VPS 1 GB tetap lega

function keepPage(obj, map, seen) {
  if (!obj?.has_continuation) return null;
  const now = Date.now();
  for (const [k, v] of pages) if (v.expires < now) pages.delete(k);
  while (pages.size >= MAX_PAGES) pages.delete(pages.keys().next().value);
  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  pages.set(token, { obj, map, seen, expires: now + PAGE_TTL });
  return token;
}

/** Ambil isi satu halaman lewat [map], buang yang sudah tampil di halaman sebelumnya. */
function take(obj, map, seen) {
  return map(obj).filter((x) => {
    if (!x || seen.has(x.id)) return false;
    // Artis/kanal: nama yang sama (mis. artis YouTube Music & kanal YouTube-nya) cukup sekali.
    const name = x.name ? `n:${x.name.toLowerCase()}` : null;
    if (name && seen.has(name)) return false;
    seen.add(x.id);
    if (name) seen.add(name);
    return true;
  });
}

const mapMusicSongs = (r) => collect(r.contents, isMusicItem).map(mapMusicItem);
/** Pencarian YouTube Music tanpa filter berisi campuran; ambil yang berjenis lagu/video saja. */
const mapMusicMixed = (kinds) => (r) => collect(r.contents, (n) => n.type === 'MusicResponsiveListItem' && kinds.includes(n.item_type)).map(mapMusicItem);
const mapVideos = (q, songsOnly) => (r) => rankVideos(q, (r.videos || collect(r.contents || r.results, (n) => n.type === 'Video')).map(mapVideo).filter(Boolean), songsOnly);
const mapChannels = (r) => collect(r.channels || r.results || r.contents, (n) => n.type === 'Channel').map((c) => ({
  id: c.author?.id || c.id,
  name: c.author?.name || text(c.title),
  thumbnail: thumbOf(c.author) || thumbOf(c),
  subscribers: text(c.subscriber_count || c.video_count),
})).filter((a) => a.id);
const mapMusicArtists = (r) => collect(r.contents, (n) => n.type === 'MusicResponsiveListItem' && n.item_type === 'artist').map((it) => {
  const id = it.id || it.endpoint?.payload?.browseId;
  if (!id) return null;
  const cols = (it.flex_columns || []).map((c) => text(c.title));
  return { id, name: text(it.name) || text(it.title) || cols[0], thumbnail: thumbOf(it), subscribers: (cols[1] || '').split(' • ').pop() };
});
const mapMusicLists = (albums) => (r) => collect(r.contents, isMusicItem).map((it) => {
  const id = it.id || it.endpoint?.payload?.browseId;
  if (!id) return null;
  const cols = (it.flex_columns || []).map((c) => text(c.title));
  return { id, title: text(it.title) || cols[0], subtitle: cols[1] || text(it.subtitle), thumbnail: thumbOf(it), album: albums };
});
const mapYtLists = (r) => collect(r.results || r.contents, (n) => n.type === 'LockupView' || n.type === 'Playlist').map((n) => {
  const id = n.content_id || n.id;
  if (!id) return null;
  return {
    id,
    title: text(n.metadata?.title) || text(n.title),
    subtitle: text(n.metadata?.metadata?.metadata_rows?.[0]?.metadata_parts?.[0]?.text) || text(n.author?.name),
    thumbnail: thumbOf(n.content_image?.primary_thumbnail?.image ? { thumbnails: n.content_image.primary_thumbnail.image } : n),
    album: false,
  };
});

const KEY = { songs: 'songs', videos: 'songs', artists: 'artists', channels: 'artists', playlists: 'playlists', albums: 'playlists', ytplaylists: 'playlists' };

/** Pencarian. [type]: songs | videos | artists | playlists | albums. Hasil + `next` (token halaman berikut). */
export async function search(q, type = 'songs') {
  const y = await yt();
  const seen = new Set();
  const key = KEY[type] || 'songs';
  // Sumber utama YouTube Music; YouTube biasa sebagai cadangan bila hasilnya terlalu sedikit.
  const plan = {
    // Filter "Lagu" YouTube Music tidak selalu tersedia (bergantung wilayah/IP server) → lagu dari pencarian
    // tanpa filter, lalu YouTube biasa yang bisa dilanjutkan tanpa batas.
    songs: [
      [() => y.music.search(q, { type: 'song' }), mapMusicSongs, 5],
      [() => y.music.search(q), mapMusicMixed(['song']), 0],
      [() => y.search(q, { type: 'video' }), mapVideos(q, true), 0],
    ],
    // Tab Video = YouTube biasa apa adanya (film, kartun, vlog, siaran, dll.) dengan urutan relevansi YouTube.
    videos: [
      [() => y.search(q, { type: 'video' }), (r) => (r.videos || collect(r.contents || r.results, (n) => n.type === 'Video')).map(mapVideo).filter(Boolean), 0],
      [() => y.music.search(q, { type: 'video' }), mapMusicSongs, 0],
    ],
    // YouTube Music: artis resmi dulu, lalu kanal YouTube supaya daftar tetap bisa di-scroll.
    artists: [[() => y.music.search(q, { type: 'artist' }), mapMusicArtists, 0], [() => y.search(q, { type: 'channel' }), mapChannels, 0]],
    // YouTube biasa: kanal & playlist dari YouTube saja.
    channels: [[() => y.search(q, { type: 'channel' }), mapChannels, 0]],
    ytplaylists: [[() => y.search(q, { type: 'playlist' }), mapYtLists, 0]],
    playlists: [[() => y.music.search(q, { type: 'playlist' }), mapMusicLists(false), 3], [() => y.search(q, { type: 'playlist' }), mapYtLists, 0]],
    albums: [[() => y.music.search(q, { type: 'album' }), mapMusicLists(true), 3], [() => y.search(q, { type: 'playlist' }), mapYtLists, 0]],
  }[type] || [];
  let items = [];
  let next = null;
  for (const [run, map, enough] of plan) {
    let r;
    try { r = await run(); } catch { continue; }
    items = [...items, ...take(r, map, seen)];
    next = keepPage(r, map, seen) || next;
    // Cukup & masih bisa dilanjutkan → berhenti; kalau sumber ini tidak punya halaman lanjutan, sambung sumber berikutnya.
    if (items.length >= enough && next) break;
  }
  // Halaman pertama minimal ±15 hasil supaya daftar langsung terasa penuh.
  if (items.length < 15 && next) {
    const more = await searchMore(next).catch(() => null);
    if (more) { items = [...items, ...more.items]; next = more.next; }
  }
  return { [key]: items, next };
}

/** Halaman berikutnya dari pencarian sebelumnya. */
export async function searchMore(token) {
  const p = pages.get(token);
  if (!p) throw Object.assign(new Error('Halaman pencarian sudah kedaluwarsa, cari ulang'), { status: 410 });
  pages.delete(token);
  // Ambil beberapa lanjutan sekaligus bila halaman YouTube isinya sedikit (setelah disaring/dibuang duplikat),
  // supaya tiap halaman berisi ±15 hasil. Maksimal 4 permintaan ke YouTube per halaman.
  let obj = p.obj, items = [];
  for (let i = 0; i < 4 && items.length < 15 && obj?.has_continuation; i++) {
    try { obj = await obj.getContinuation(); } catch { break; }
    items = [...items, ...take(obj, p.map, p.seen)];
  }
  return { items, next: keepPage(obj, p.map, p.seen) };
}

export async function suggest(q, src = 'music') {
  const y = await yt();
  if (src === 'youtube') {
    try {
      const r = await y.getSearchSuggestions(q);
      if (r?.length) return r.map(text).slice(0, 8);
    } catch { /* lanjut ke YouTube Music */ }
  }
  try {
    const r = await y.music.getSearchSuggestions(q);
    const out = collect(r, (n) => n.type === 'SearchSuggestion').map((s) => text(s.suggestion));
    if (out.length) return out.slice(0, 8);
  } catch { /* lanjut */ }
  try {
    const r = await y.getSearchSuggestions(q);
    return (r || []).map(text).slice(0, 8);
  } catch {
    return [];
  }
}

/** Lagu-lagu "berikutnya" (radio) untuk [id] — dipakai putar otomatis & rekomendasi. */
/** Video terkait ala YouTube ("Berikutnya") dari halaman tonton YouTube biasa. */
async function youtubeRelated(id) {
  const y = await yt();
  const info = await y.getInfo(id);
  const lockup = (n) => {
    const rows = (n.metadata?.metadata?.metadata_rows || []).map((r) => (r.metadata_parts || []).map((p) => text(p.text)));
    // Durasi ada di lencana gambar, formatnya mengikuti bahasa ("10.47" / "1:02:03").
    const badge = (n.content_image?.overlays || []).flatMap((o) => o.badges || []).map((b) => text(b.text)).find((t) => /^\d+([.:]\d{2}){1,2}$/.test(t));
    const [views, published] = rows[1] || [];
    return {
      id: n.content_id, title: text(n.metadata?.title), artist: rows[0]?.[0] || '', artistId: null, album: null,
      duration: parseDuration(badge?.replace(/\./g, ':')), thumbnail: thumbOf({ thumbnails: n.content_image?.image || n.content_image?.primary_thumbnail?.image }),
      views: views ? (/\d/.test(views) && !/[a-z]{3,}/i.test(views) ? `${views} x ditonton` : views) : null, published: published || null,
    };
  };
  return uniq((info.watch_next_feed || []).map((n) => {
    if (n.type === 'CompactVideo') return mapVideo(n);
    if (n.type === 'LockupView' && n.content_type === 'VIDEO') return lockup(n);
    return null;
  })).filter((s) => s.id !== id);
}

export async function related(id, src = 'music') {
  const y = await yt();
  if (src === 'youtube') {
    try { const list = await youtubeRelated(id); if (list.length) return list; } catch { /* ke YouTube Music */ }
  }
  try {
    const r = await y.music.getUpNext(id, true);
    const list = (r.contents || []).map((it) => {
      const vid = it.video_id || it.id;
      if (!vid) return null;
      return {
        id: vid,
        title: text(it.title),
        artist: it.artists?.map((a) => a.name).join(', ') || it.author || '',
        artistId: it.artists?.[0]?.channel_id || null,
        album: it.album?.name || null,
        duration: it.duration?.seconds || parseDuration(text(it.duration?.text)),
        thumbnail: thumbOf(it),
      };
    }).filter(Boolean);
    if (list.length > 1) return uniq(list).filter((s) => s.id !== id);
  } catch { /* lanjut */ }
  const info = await y.getInfo(id);
  return uniq((info.watch_next_feed || []).map((n) => {
    if (n.type === 'CompactVideo') return mapVideo(n);
    if (n.type === 'LockupView' && n.content_type === 'VIDEO') {
      return { id: n.content_id, title: text(n.metadata?.title), artist: text(n.metadata?.metadata?.metadata_rows?.[0]?.metadata_parts?.[0]?.text), artistId: null, album: null, duration: 0, thumbnail: thumbOf({ thumbnails: n.content_image?.image }) };
    }
    return null;
  })).filter((s) => s.id !== id);
}

/** Info satu lagu (untuk link yang dibagikan). */
export async function song(id) {
  const y = await yt();
  const info = await y.getBasicInfo(id);
  const b = info.basic_info;
  return { id, title: b.title || '', artist: b.author || '', artistId: b.channel_id || null, album: null, duration: b.duration || 0, thumbnail: thumbOf({ thumbnails: b.thumbnail }) };
}

/** Halaman artis: lagu populer + daftar rilis. [id] = channel id. */
export async function artist(id) {
  const y = await yt();
  try {
    const a = await y.music.getArtist(id);
    const songs = uniq(collect(a.sections, isMusicItem).filter((n) => n.type === 'MusicResponsiveListItem').map(mapMusicItem));
    const releases = collect(a.sections, (n) => n.type === 'MusicTwoRowItem').map((n) => ({
      id: n.id || n.endpoint?.payload?.browseId, title: text(n.title), subtitle: text(n.subtitle), thumbnail: thumbOf(n), album: true,
    })).filter((p) => p.id && !p.id.startsWith('UC'));
    const header = a.header;
    const name = text(header?.title) || songs[0]?.artist || '';
    if (songs.length) {
      return { id, name, thumbnail: thumbOf(header?.thumbnail ? { thumbnail: header.thumbnail } : header), description: text(header?.description), songs, releases };
    }
  } catch { /* lanjut ke kanal biasa */ }
  const ch = await y.getChannel(id);
  const videos = await ch.getVideos().catch(() => null);
  const songs = uniq((videos?.videos || []).map(mapVideo));
  return { id, name: text(ch.metadata?.title), thumbnail: thumbOf({ thumbnails: ch.metadata?.avatar }), description: text(ch.metadata?.description), songs, releases: [] };
}

/** Isi playlist / album (id "PL…", "OLAK…", "VL…", atau "MPRE…"). */
export async function playlist(id) {
  const y = await yt();
  if (id.startsWith('MPRE')) {
    const a = await y.music.getAlbum(id);
    const songs = uniq((a.contents || []).map(mapMusicItem));
    const thumb = thumbOf(a.header?.thumbnail ? { thumbnail: a.header.thumbnail } : a.header);
    return { id, title: text(a.header?.title), subtitle: text(a.header?.subtitle), thumbnail: thumb, songs: songs.map((s) => ({ ...s, thumbnail: s.thumbnail || thumb })) };
  }
  const plId = id.startsWith('VL') ? id.slice(2) : id;
  try {
    const p = await y.music.getPlaylist(plId);
    let songs = uniq((p.contents || p.items || []).map(mapMusicItem));
    let page = p;
    for (let i = 0; i < 4 && page.has_continuation && songs.length < 500; i++) {
      page = await page.getContinuation();
      songs = uniq([...songs, ...(page.contents || page.items || []).map(mapMusicItem)]);
    }
    if (songs.length) return { id, title: text(p.header?.title), subtitle: text(p.header?.subtitle), thumbnail: thumbOf(p.header?.thumbnail ? { thumbnail: p.header.thumbnail } : p.header), songs };
  } catch { /* lanjut */ }
  const p = await y.getPlaylist(plId);
  let songs = uniq((p.videos || []).map(mapVideo));
  let page = p;
  for (let i = 0; i < 4 && page.has_continuation && songs.length < 500; i++) {
    page = await page.getContinuation();
    songs = uniq([...songs, ...(page.videos || []).map(mapVideo)]);
  }
  return { id, title: text(p.info?.title), subtitle: text(p.info?.author?.name), thumbnail: thumbOf({ thumbnails: p.info?.thumbnails }), songs };
}

/** Lirik tanpa waktu dari YouTube Music (cadangan bila LRCLIB tidak punya). */
export async function plainLyrics(id) {
  const y = await yt();
  try {
    const l = await y.music.getLyrics(id);
    return text(l?.description) || null;
  } catch {
    return null;
  }
}
