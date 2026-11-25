// Manga/manhwa/manhua Freease Stream. Sumber Indonesia: Komiku, Shinigami, Komikindo, Bacakomik, WEBTOON; Inggris:
// MangaPark, MangaGoku. Id berawalan sumber (km:, sh:, ki:, bk:, wt:, mp:, kk:) supaya satu rute melayani semuanya.
// Gambar selalu lewat proxy server (imgUrl) karena banyak CDN komik menolak tanpa Referer yang pas.
import { fetchJson, fetchText, htmlLine, htmlText, quiet, sameTitle, SourceError, ttlCache, UA_DESKTOP } from './net.js';
import { imgUrl } from './media.js';

const cache = ttlCache(500);
const cached = (key, ttl, load) => cache(key, ttl, load);
const MIN = 60_000;

const status = (s) => {
  const t = String(s ?? '').toLowerCase();
  if (/ongoing|berjalan|releasing/.test(t)) return 'Ongoing';
  if (/complete|tamat|end/.test(t)) return 'Tamat';
  if (/hiatus/.test(t)) return 'Hiatus';
  return null;
};
const chapterNum = (s) => String(s ?? '').match(/(\d+(?:\.\d+)?)/)?.[1]?.replace(/^0+(?=\d)/, '') ?? null;

/** Bab dengan nomor sama dari satu sumber cukup satu (yang terbaru); urut naik menurut nomor. */
function tidyChapters(list) {
  const byNum = new Map();
  const odd = [];
  for (const c of list) {
    if (c.number == null || !Number.isFinite(Number(c.number))) { odd.push(c); continue; }
    const k = Number(c.number);
    const old = byNum.get(k);
    if (!old || (c.at ?? 0) > (old.at ?? 0)) byNum.set(k, c);
  }
  return [...byNum.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c).concat(odd);
}

// ---------------------------------------------------------------- Komiku (Indonesia)
const KM = { site: 'https://komiku.org', api: 'https://api.komiku.org/' };
const kmImg = (u) => imgUrl(u, 'https://komiku.org/');
function kmList(html) {
  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(/<div class="bge">([\s\S]*?)<\/div>\s*<\/div>/g)) {
    const b = m[1];
    const slug = b.match(/href="[^"]*\/manga\/([^/"]+)\/?"/)?.[1];
    const title = b.match(/<h3>\s*([\s\S]*?)\s*<\/h3>/)?.[1];
    if (!slug || !title || seen.has(slug)) continue;
    seen.add(slug);
    const cover = b.match(/<img[^>]+(?:data-src|src)="(https?:[^"]+)"/)?.[1];
    const type = b.match(/<b>\s*(Manga|Manhwa|Manhua)\s*<\/b>/i)?.[1] ?? null;
    const latest = b.match(/Terbaru:?[\s\S]*?<span>\s*Chapter\s*([\d.]+)/i)?.[1] ?? b.match(/Chapter\s*([\d.]+)/i)?.[1] ?? null;
    out.push({ id: 'km:' + slug, title: htmlLine(title), cover: kmImg(cover ? htmlLine(cover).split('?')[0] : null), type, latest, source: 'Komiku', lang: 'id' });
  }
  return out;
}
const komiku = {
  name: 'Komiku', lang: 'id',
  async browse({ order = 'popular', page = 1, type, genre } = {}) {
    const o = order === 'latest' ? 'modified' : 'meta_value_num';
    const path = page > 1 ? `manga/page/${page}/` : 'manga/';
    const q = new URLSearchParams({ orderby: o });
    if (type) q.set('tipe', String(type).toLowerCase());
    if (genre) q.set('genre', String(genre).toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    const { text } = await fetchText(`${KM.api}${path}?${q}`);
    return kmList(text);
  },
  async search(q) {
    const { text } = await fetchText(`${KM.api}?post_type=manga&s=${encodeURIComponent(q)}`);
    return kmList(text);
  },
  async detail(raw) {
    const { text: h } = await fetchText(`${KM.site}/manga/${encodeURIComponent(raw)}/`);
    const row = (label) => { const m = h.match(new RegExp(`<td>${label}:?</td>\\s*<td[^>]*>([\\s\\S]*?)</td>`)); return m ? htmlText(m[1]) || null : null; };
    const title = row('Judul') ?? htmlLine(h.match(/<meta property="og:title" content="(?:Komik )?([^"]+)"/)?.[1] ?? raw);
    const chapters = [...h.matchAll(/<td class="judulseries">[\s\S]*?<a href="(\/[^"]+)"[^>]*>[\s\S]*?<b>([\s\S]*?)<\/b>[\s\S]*?<td class="tanggalseries">\s*([^<]*?)\s*<\/td>/g)].map((m) => {
      const label = htmlLine(m[2]);
      const [d, mo, y] = m[3].split('/').map(Number);
      return { id: 'km:' + m[1], number: chapterNum(label), title: /^Chapter\s+[\d.]+$/i.test(label) ? null : label, at: y ? Date.UTC(y, mo - 1, d) : null };
    });
    return {
      id: 'km:' + raw, title, source: 'Komiku', lang: 'id',
      cover: kmImg(h.match(/<meta property="og:image" content="([^"]+)"/)?.[1]?.split('?')[0]),
      description: htmlText(h.match(/<p class="desc"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? ''),
      genres: [...h.matchAll(/<li class="genre">[\s\S]*?<span>([\s\S]*?)<\/span>/g)].map((m) => htmlLine(m[1])),
      status: status(row('Status')), author: row('Author') ?? row('Pengarang'), type: row('Tipe') ?? row('Jenis Komik'),
      altTitles: (row('Judul Alternatif') ?? row('Judul Indonesia') ?? '').split(/[,/]/).map((s) => s.trim()).filter((s) => s && s !== title),
      chapters: tidyChapters(chapters),
    };
  },
  async pages(raw) {
    const { text: h } = await fetchText(KM.site + raw);
    const start = Math.max(0, h.indexOf('id="Baca_Komik"'));
    const imgs = [...h.slice(start).matchAll(/<img[^>]+src="(https:\/\/img\.komiku[^"]+)"/g)].map((m) => htmlLine(m[1])).filter((u) => u.includes('/upload'));
    return [...new Set(imgs)].map(kmImg);
  },
};

// ---------------------------------------------------------------- Shinigami (Indonesia, JSON)
const SH = 'https://api.shngm.io/v1';
const shCard = (d) => ({
  id: 'sh:' + d.manga_id, title: String(d.title ?? '').trim(), cover: imgUrl(d.cover_portrait_url || d.cover_image_url || null, 'https://shinigami.asia/'),
  type: d.taxonomy?.Format?.[0]?.name ?? null, latest: d.latest_chapter_number != null ? String(d.latest_chapter_number) : null,
  source: 'Shinigami', lang: 'id', altTitles: String(d.alternative_title ?? '').split(',').map((s) => s.trim()).filter(Boolean),
});
const shinigami = {
  name: 'Shinigami', lang: 'id',
  async browse({ order = 'popular', page = 1, type } = {}) {
    const q = new URLSearchParams({ page: String(page), page_size: '30', sort: order === 'latest' ? 'latest' : 'popularity' });
    if (type) q.set('format', String(type).toLowerCase());
    const j = await fetchJson(`${SH}/manga/list?${q}`, { timeout: 10000 });
    return (j.data ?? []).map(shCard);
  },
  async search(qs) {
    const j = await fetchJson(`${SH}/manga/list?page=1&page_size=20&q=${encodeURIComponent(qs)}`, { timeout: 10000 });
    return (j.data ?? []).map(shCard);
  },
  async detail(raw) {
    const j = await fetchJson(`${SH}/manga/detail/${encodeURIComponent(raw)}`);
    const d = j.data;
    if (!d) throw new SourceError('Komik tidak ditemukan', 404);
    // API Shinigami hanya melayani halaman pertama (halaman lain 502): ambil 24 bab awal + 24 bab terbaru.
    const url = (order) => `${SH}/chapter/${encodeURIComponent(raw)}/list?page=1&page_size=24&sort_by=chapter_number&sort_order=${order}`;
    const [asc, desc] = await Promise.all([fetchJson(url('asc')), fetchJson(url('desc')).catch(() => ({ data: [] }))]);
    const chapters = [...(asc.data ?? []), ...(desc.data ?? [])].map((x) => ({ id: 'sh:' + x.chapter_id, number: x.chapter_number != null ? String(x.chapter_number) : null, title: x.chapter_title || null, at: Date.parse(x.release_date) || null }));
    const partial = (asc.meta?.total_record ?? 0) > new Set(chapters.map((c) => c.id)).size;
    return {
      ...shCard(d), description: htmlText(d.description ?? ''),
      genres: (d.taxonomy?.Genre ?? []).map((g) => g.name).filter(Boolean),
      status: { 1: 'Ongoing', 2: 'Tamat', 3: 'Hiatus' }[d.status] ?? null,
      author: (d.taxonomy?.Author ?? []).map((a) => a.name).join(', ') || null,
      chapters: tidyChapters(chapters), partial,
    };
  },
  async pages(raw) {
    const j = await fetchJson(`${SH}/chapter/detail/${encodeURIComponent(raw)}`);
    const d = j.data;
    if (!d) return [];
    return (d.chapter?.data ?? []).map((f) => imgUrl(String(d.base_url ?? '').replace(/\/$/, '') + d.chapter.path + f, 'https://shinigami.asia/'));
  },
};

// ---------------------------------------------------------------- WEBTOON (resmi, Indonesia)
const wtImg = (u) => imgUrl(u, 'http://www.webtoons.com');
const wtPath = new Map();
const webtoon = {
  name: 'WEBTOON', lang: 'id',
  async search(q) {
    const { text: h } = await fetchText(`https://www.webtoons.com/id/search?keyword=${encodeURIComponent(q)}`, { ua: UA_DESKTOP });
    const out = [];
    const anchors = [...h.matchAll(/<a href="(https:\/\/www\.webtoons\.com\/(?:id|en)\/([^"]+?)\/list\?title_no=(\d+))"[^>]*class="link _card_item"[^>]*data-webtoon-type="(\w+)"[^>]*>/g)];
    anchors.forEach((m, i) => {
      const block = h.slice(m.index + m[0].length, anchors[i + 1]?.index ?? m.index + 3000);
      const title = htmlText(block.match(/<strong class="title">([\s\S]*?)<\/strong>/)?.[1] ?? '');
      if (!title) return;
      const kind = /^WEBTOON$/i.test(m[4]) ? 'w' : 'c';
      const id = `wt:${kind}:${m[3]}`;
      wtPath.set(id, m[2]);
      out.push({ id, title, cover: wtImg(block.match(/<img[^>]+src="([^"]+)"/)?.[1]?.split('?')[0]), type: 'Webtoon', source: 'WEBTOON', lang: 'id', author: htmlText(block.match(/<div class="author">([^<]*)<\/div>/)?.[1] ?? '') || null });
    });
    return out;
  },
  async browse({ page = 1 } = {}) {
    if (page > 1) return [];
    const { text: h } = await fetchText('https://www.webtoons.com/id/ranking/trending', { ua: UA_DESKTOP });
    const out = [];
    const seen = new Set();
    for (const m of h.matchAll(/<a href="https:\/\/www\.webtoons\.com\/id\/([^"]+?)\/list\?title_no=(\d+)"[^>]*data-webtoon-type="(\w+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const id = `wt:${/^WEBTOON$/i.test(m[3]) ? 'w' : 'c'}:${m[2]}`;
      if (seen.has(id)) continue;
      const title = htmlText(m[4].match(/<strong class="title">([\s\S]*?)<\/strong>/)?.[1] ?? '');
      if (!title) continue;
      seen.add(id);
      wtPath.set(id, m[1]);
      out.push({ id, title, cover: wtImg(m[4].match(/<img[^>]+src="([^"]+)"/)?.[1]?.split('?')[0]), type: 'Webtoon', source: 'WEBTOON', lang: 'id', genre: m[4].match(/<p class="genre">([^<]*)/)?.[1]?.trim() ?? null });
    }
    return out;
  },
  async detail(raw) {
    const [kind, no] = raw.split(':');
    if (!/^[wc]$/.test(kind) || !/^\d+$/.test(no)) throw new SourceError('ID tidak valid', 400);
    const id = `wt:${raw}`;
    const path = wtPath.get(id) ?? (kind === 'c' ? 'canvas/a' : 'a/a');
    const { text: h, url } = await fetchText(`https://www.webtoons.com/id/${path}/list?title_no=${no}`, { ua: UA_DESKTOP, headers: { referer: 'https://www.webtoons.com/' } });
    const real = url.match(/webtoons\.com\/(?:id|en)\/([^?]+?)\/list/)?.[1] ?? path;
    wtPath.set(id, real);
    const title = htmlText(h.match(/<h1 class="subj">([\s\S]*?)<\/h1>/)?.[1] ?? h.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ?? raw);
    const chapters = [];
    let cursor = '';
    for (let i = 0; i < 30; i++) {
      const j = await fetchJson(`https://m.webtoons.com/api/v1/${kind === 'w' ? 'webtoon' : 'canvas'}/${no}/episodes?pageSize=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { headers: { referer: 'https://m.webtoons.com/' } });
      const r = j.result ?? j;
      for (const e of r.episodeList ?? []) if (e.viewerLink) chapters.push({ id: 'wt:/' + String(e.viewerLink).replace(/^\/+/, '') + '/', title: e.episodeTitle || null, at: e.exposureDateMillis ?? null });
      cursor = r.nextCursor ?? '';
      if (!cursor || !(r.episodeList ?? []).length) break;
    }
    chapters.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
    chapters.forEach((c, i) => { c.number = String(i + 1); });
    return {
      id, title, source: 'WEBTOON', lang: 'id', type: 'Webtoon',
      cover: wtImg(h.match(/<meta property="og:image" content="([^"]+)"/)?.[1]?.split('?')[0]),
      description: htmlText(h.match(/<meta property="og:description" content="([^"]*)"/)?.[1] ?? ''),
      genres: [htmlText(h.match(/<h2 class="genre[^"]*">([\s\S]*?)<\/h2>/)?.[1] ?? '')].filter(Boolean),
      status: null, author: h.match(/<meta property="com-linewebtoon:webtoon:author" content="([^"]*)"/)?.[1] || null, altTitles: [],
      chapters,
    };
  },
  async pages(raw) {
    const path = raw.replace(/^\/+|\/+$/g, '');
    const { text: h } = await fetchText(`https://www.webtoons.com/${path}`, { ua: UA_DESKTOP, headers: { referer: 'https://www.webtoons.com/' } });
    const start = Math.max(0, h.indexOf('id="_imageList"'));
    const imgs = [...h.slice(start).matchAll(/data-url="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&')).filter((u) => u.includes('webtoon-phinf.pstatic.net'));
    return [...new Set(imgs)].map(wtImg);
  },
};

// ---------------------------------------------------------------- MangaPark (Inggris)
const MP = 'https://mangapark.cc';
const mpAbs = (u) => (!u ? null : u.startsWith('//') ? 'https:' + u : u.startsWith('http') ? u : MP + (u.startsWith('/') ? u : '/' + u));
const mpImg = (u) => imgUrl(mpAbs(u), MP + '/');
const unjson = (s) => s.replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\\//g, '/').replace(/\\"/g, '"');
function mpList(h) {
  const out = new Map();
  for (const m of h.matchAll(/\{"@type":"ListItem","position":\d+,"url":"https:\/\/mangapark\.cc\/manga\/([^"]+)","name":"([^"]+)"\}/g)) {
    const slug = m[1].split(/[/?]/)[0];
    if (slug && !out.has(slug)) out.set(slug, { id: 'mp:' + slug, title: unjson(m[2]), cover: null, source: 'MangaPark', lang: 'en' });
  }
  if (!out.size) {
    for (const m of h.matchAll(/href="\/manga\/([^"/?#]+)"[^>]*title="([^"]+)"/g)) if (!out.has(m[1])) out.set(m[1], { id: 'mp:' + m[1], title: htmlLine(m[2]), cover: null, source: 'MangaPark', lang: 'en' });
  }
  for (const b of h.matchAll(/<a[^>]+href="\/manga\/([^"/?#]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const it = out.get(b[1]);
    const img = b[2].match(/<img[^>]+(?:data-src|src)="([^"]+)"/)?.[1];
    if (it && !it.cover && img) it.cover = mpImg(img);
  }
  return [...out.values()];
}
const mangapark = {
  name: 'MangaPark', lang: 'en',
  async browse({ page = 1 } = {}) { return mpList((await fetchText(`${MP}/search?page=${page}`, { headers: { referer: MP + '/' } })).text); },
  async search(q) { return mpList((await fetchText(`${MP}/search?q=${encodeURIComponent(q)}`, { headers: { referer: MP + '/' } })).text); },
  async detail(raw) {
    const slug = raw.split('|')[0];
    const [{ text: h }, ch] = await Promise.all([
      fetchText(`${MP}/manga/${encodeURIComponent(slug)}`, { headers: { referer: MP + '/' } }),
      fetchText(`${MP}/manga/${encodeURIComponent(slug)}/chapters`, { headers: { referer: MP + '/' } }).then((r) => r.text).catch(() => ''),
    ]);
    const title = htmlText(h.match(/property="og:title"\s+content="([^"]+)"/)?.[1] ?? slug).split(' - MangaPark')[0].split(' |')[0].replace(/\s+(Manga|Manhwa|Manhua)?\s*[–-]\s*Read Online.*$/i, '').trim();
    const chapters = [];
    for (const m of ch.matchAll(/<li[^>]*class="[^"]*item[^"]*"[^>]*data-number="([^"]*)"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/li>/g)) {
      const spans = [...m[3].matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map((s) => htmlText(s[1]));
      const label = (spans[0] ?? '').replace(/^[A-Z]{2}\s*/, '');
      const lang = m[3].match(/class="[^"]*flag\s+([A-Z]{2})/)?.[1]?.toLowerCase() ?? 'en';
      if (lang !== 'en') continue;
      chapters.push({ id: `mp:${slug}|${m[2]}`, number: m[1] || chapterNum(m[2].match(/chapter[ -]*([\d.]+)/i)?.[1]), title: label.replace(/^Chapter\s*[\d.]+[:\s-]*/i, '').trim() || null, at: Date.parse(spans.at(-1) ?? '') || null });
    }
    if (!chapters.length) for (const m of ch.matchAll(/href="(\/read\/[^"]+chapter[^"]*)"[^>]*>([^<]*)/gi)) chapters.push({ id: `mp:${slug}|${m[1]}`, number: chapterNum(m[1].match(/chapter[ -]*([\d.]+)/i)?.[1]), title: null, at: null });
    const st = /status[^<]{0,80}Completed/i.test(h) ? 'Tamat' : /status[^<]{0,80}(Ongoing|Releasing)/i.test(h) ? 'Ongoing' : /status[^<]{0,80}Hiatus/i.test(h) ? 'Hiatus' : null;
    return {
      id: 'mp:' + slug, title, source: 'MangaPark', lang: 'en', type: 'Manga',
      cover: mpImg(h.match(/property="og:image"\s+content="([^"]+)"/)?.[1]),
      description: htmlText(h.match(/property="og:description"\s+content="([^"]+)"/)?.[1] ?? ''),
      genres: [...new Set([...h.matchAll(/\/genre\/([^"?]+)"/g)].map((m) => m[1].replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())))].slice(0, 12),
      status: st, author: htmlText(h.match(/class="[^"]*author[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? '') || null,
      altTitles: [...(h.match(/"alternateName"\s*:\s*\[([^\]]*)\]/)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((m) => unjson(m[1])),
      chapters: tidyChapters(chapters),
    };
  },
  async pages(raw) {
    const path = raw.split('|')[1] ?? '';
    if (!path.startsWith('/')) return [];
    const { text: h } = await fetchText(MP + path, { headers: { referer: MP + '/' } });
    const sec = h.match(/<section[^>]*class="[^"]*chapter-reader[^"]*"[^>]*>([\s\S]*?)<\/section>/)?.[1] ?? h;
    let imgs = [...sec.matchAll(/<img[^>]+(?:data-src|src)="([^"]+)"/g)].map((m) => mpAbs(m[1])).filter((u) => /\.(jpe?g|png|webp)(\?|$)/i.test(u) && !/logo|icon|avatar|no-cover/.test(u));
    if (!imgs.length) imgs = [...h.matchAll(/https?:\/\/[^"'\s\\>]+\/storage\/chapters\/[^"'\s\\<]+\.(?:jpe?g|png|webp)/gi)].map((m) => m[0].replace(/\\\//g, '/'));
    return [...new Set(imgs)].map((u) => imgUrl(u, MP + '/'));
  },
};

// ---------------------------------------------------------------- MangaGoku (Inggris, jaringan MangaKakalot)
// Cermin MangaKakalot lain (mangakakalot.gg, natomanga, nelomanga) memblokir IP server lewat Cloudflare.
const KK = 'https://www.mangagoku.com';
const kkImg = (u) => imgUrl(u ? (u.startsWith('//') ? 'https:' + u : u.startsWith('http') ? u : KK + u) : null, KK + '/');
function kkList(h) {
  const covers = new Map();
  for (const m of h.matchAll(/<img src="([^"]+)" alt="([^"]*)"/g)) if (!covers.has(m[2])) covers.set(decodeEntitiesSafe(m[2]), m[1]);
  const out = new Map();
  for (const m of h.matchAll(/<a title="([^"]+)"[^>]*href="\/manga\/([a-z0-9-]+)"/g)) {
    const title = htmlLine(m[1]);
    if (out.has(m[2])) continue;
    out.set(m[2], { id: 'kk:' + m[2], title, cover: kkImg(covers.get(title)), source: 'MangaGoku', lang: 'en' });
  }
  return [...out.values()];
}
const decodeEntitiesSafe = (s) => htmlLine(s);
const kakalot = {
  name: 'MangaGoku', lang: 'en',
  async browse({ order = 'popular', page = 1 } = {}) {
    const { text } = await fetchText(`${KK}/manga-list/${order === 'latest' ? 'latest-manga' : 'hot-manga'}?page=${page}`, { headers: { referer: KK + '/' } });
    return kkList(text);
  },
  async search(q) {
    const { text } = await fetchText(`${KK}/search?q=${encodeURIComponent(q)}`, { headers: { referer: KK + '/' } });
    return kkList(text);
  },
  async detail(raw) {
    const slug = raw.split('|')[0];
    if (!/^[a-z0-9-]+$/.test(slug)) throw new SourceError('ID tidak valid', 400);
    const [{ text: h }, api] = await Promise.all([
      fetchText(`${KK}/manga/${slug}`, { headers: { referer: KK + '/' } }),
      fetchJson(`${KK}/api/manga/${slug}/chapters?limit=5000`, { headers: { referer: `${KK}/manga/${slug}` } }).catch(() => null),
    ]);
    const info = {};
    for (const m of h.matchAll(/text-white\/45">([^<]+)<\/span><span[^>]*>([\s\S]*?)<\/span><\/div>/g)) info[m[1].trim().toLowerCase()] = htmlText(m[2]);
    const chapters = (api?.data?.chapters ?? []).filter((c) => c.chapter_slug).map((c) => ({
      id: `kk:${slug}|${c.chapter_slug}`, number: c.chapter_num != null ? String(c.chapter_num) : chapterNum(c.chapter_slug),
      title: String(c.chapter_name ?? '').replace(/^Chapter\s*[\d.]+[:\s-]*/i, '').trim() || null, at: Date.parse(String(c.updated_at ?? '').replace(' ', 'T') + 'Z') || null,
    }));
    return {
      id: 'kk:' + slug, title: htmlText(h.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ?? slug).split(' | ')[0], source: 'MangaGoku', lang: 'en', type: 'Manga',
      cover: kkImg(h.match(/<meta property="og:image" content="([^"]+)"/)?.[1]), description: '',
      genres: [...new Set([...h.matchAll(/href="\/genre\/([a-z0-9-]+)"[^>]*>([^<]+)</g)].filter((m) => m[1] !== 'all').map((m) => htmlLine(m[2])))],
      status: status(info.status), author: info.author || null, altTitles: [],
      chapters: tidyChapters(chapters),
    };
  },
  async pages(raw) {
    const [slug, ch] = raw.split('|');
    if (!/^[a-z0-9-]+$/.test(slug ?? '') || !/^[a-z0-9._-]+$/i.test(ch ?? '')) return [];
    const { text: h } = await fetchText(`${KK}/manga/${slug}/${ch}`, { headers: { referer: `${KK}/manga/${slug}` } });
    const imgs = [...h.matchAll(/https:\/\/[a-z0-9.-]+\/[^"'\s\\]+\.(?:webp|jpe?g|png)/gi)].map((m) => m[0])
      .filter((u) => u.includes(`/${slug}/`) && !u.includes('/thumb/'));
    return [...new Set(imgs)].map(kkImg);
  },
};

// ---------------------------------------------------------------- Komikindo & Bacakomik (Indonesia, tema yang sama)
// Halaman bab memuat banner iklan di antara gambar; yang diambil cuma gambar ber-alt judul bab itu.
function animposx(name, base, listPath) {
  const img = (u) => imgUrl(u ? htmlLine(u) : null, base + '/');
  const slugOf = (u) => String(u ?? '').match(/\/komik\/([^/"?#]+)\/?/)?.[1];
  const key = name === 'Komikindo' ? 'ki' : 'bk';
  const list = (h) => {
    const out = [];
    const seen = new Set();
    for (const m of h.matchAll(/<div class="animposx">([\s\S]*?)(?=<div class="animepost">|<\/section>|$)/g)) {
      const b = m[1].slice(0, 6000);
      const slug = slugOf(b.match(/<a href="([^"]+)"/)?.[1]);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      const title = htmlLine(b.match(/title="(?:Komik\s+)?([^"]+)"/)?.[1] ?? slug);
      out.push({
        id: `${key}:${slug}`, title, source: name, lang: 'id',
        cover: img((b.match(/data-lazy-src="([^"]+)"/) ?? b.match(/<img[^>]+src="(https:[^"]+)"/))?.[1]?.replace(/\?resize=.*$/, '')),
        type: b.match(/typeflag (Manga|Manhwa|Manhua)/i)?.[1] ?? null,
        latest: chapterNum(b.match(/Ch(?:apter)?\.?\s*([\d.]+)/i)?.[1]),
      });
    }
    return out;
  };
  return {
    name, lang: 'id',
    async browse({ order = 'popular', page = 1, type } = {}) {
      const q = new URLSearchParams({ order: order === 'latest' ? 'update' : 'popular' });
      if (type) q.set('type', String(type).toLowerCase());
      const { text } = await fetchText(`${base}/${listPath}/${page > 1 ? `page/${page}/` : ''}?${q}`, { ua: UA_DESKTOP });
      return list(text);
    },
    async search(q) {
      const { text } = await fetchText(`${base}/?s=${encodeURIComponent(q)}`, { ua: UA_DESKTOP });
      return list(text);
    },
    async detail(raw) {
      const { text: h } = await fetchText(`${base}/komik/${encodeURIComponent(raw)}/`, { ua: UA_DESKTOP });
      const spe = (label) => { const m = h.match(new RegExp(`<b>${label}:?</b>([\\s\\S]*?)</span>`, 'i')); return m ? htmlLine(m[1]) || null : null; };
      const title = htmlLine(h.match(/<h1 class="entry-title"[^>]*>\s*(?:Komik\s+)?([\s\S]*?)<\/h1>/)?.[1] ?? raw);
      const thumb = h.match(/class="thumb"[\s\S]{0,800}?(?:data-lazy-src|src)="(https:[^"]+)"/)?.[1];
      const chapters = [...h.matchAll(/<span class="lchx">\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => {
        const path = m[1].replace(base, '');
        return { id: `${key}:${path}`, number: chapterNum(htmlLine(m[2])), title: null, at: null };
      }).filter((c) => c.id.startsWith(`${key}:/`));
      return {
        id: `${key}:${raw}`, title, source: name, lang: 'id', cover: img(thumb?.replace(/\?resize=.*$/, '')),
        description: htmlText(h.match(/entry-content-single"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? ''),
        genres: [...(h.match(/class="genre-info"[\s\S]*?<\/div>/)?.[0] ?? h.match(/<div class="genre[^"]*">([\s\S]*?)<\/div>/)?.[1] ?? '').matchAll(/rel="tag"[^>]*>([^<]+)</g)].map((m) => htmlLine(m[1])),
        status: status(spe('Status')), author: spe('Pengarang') ?? spe('Author'), type: spe('Jenis Komik') ?? spe('Grafis'),
        altTitles: (spe('Judul Alternatif') ?? '').split(',').map((x) => x.trim()).filter((x) => x && x !== title).slice(0, 6),
        chapters: tidyChapters(chapters),
      };
    },
    async pages(raw) {
      if (!/^\/[a-z0-9._%-]+\/?$/i.test(raw)) throw new SourceError('ID bab tidak valid', 400);
      const { text: c } = await fetchText(base + raw, { ua: UA_DESKTOP });
      const t = htmlLine(c.match(/<h1 class="entry-title"[^>]*>\s*(?:Komik\s+)?([\s\S]*?)<\/h1>/)?.[1] ?? '');
      const urls = [...c.matchAll(/<img\b([^>]*)>/g)].map((m) => m[1])
        .filter((a) => t && htmlLine(a.match(/alt="([^"]*)"/)?.[1] ?? '') === t)
        .map((a) => (a.match(/data-lazy-src="([^"]+)"/) ?? a.match(/\ssrc="(https:[^"]+)"/))?.[1])
        .filter(Boolean).map(htmlLine);
      return [...new Set(urls)].map(img);
    },
  };
}
const komikindo = animposx('Komikindo', 'https://komikindo.ch', 'daftar-manga');
const bacakomik = animposx('Bacakomik', 'https://bacakomik.my', 'daftar-komik');

// ---------------------------------------------------------------- gabungan
export const SOURCES = { km: komiku, sh: shinigami, ki: komikindo, bk: bacakomik, wt: webtoon, mp: mangapark, kk: kakalot };
export const SOURCE_LIST = Object.entries(SOURCES).map(([key, s]) => ({ key, name: s.name, lang: s.lang, browse: !!s.browse }));

function route(id) {
  const m = String(id ?? '').match(/^(km|sh|ki|bk|wt|mp|kk):(.{1,400})$/s);
  if (!m) throw new SourceError('ID komik tidak valid', 400);
  return { src: SOURCES[m[1]], raw: m[2] };
}

export async function browse(source, opts = {}) {
  const s = SOURCES[source];
  if (!s) throw new SourceError('Sumber tidak dikenal', 400);
  const page = Math.max(1, Math.min(200, Number(opts.page) || 1));
  return cached(`b:${source}:${opts.order}:${page}:${opts.type ?? ''}:${opts.genre ?? ''}`, 10 * MIN, () => s.browse({ ...opts, page }));
}

/** Cari di semua sumber sekaligus; sumber yang gagal/lambat dilewati. */
export async function search(q, lang) {
  const s = String(q ?? '').trim().slice(0, 100);
  if (!s) return [];
  return cached(`s:${s.toLowerCase()}:${lang ?? ''}`, 10 * MIN, async () => {
    const keys = Object.keys(SOURCES).filter((k) => !lang || SOURCES[k].lang === lang);
    const res = await Promise.all(keys.map((k) => quiet(SOURCES[k].search(s), 12000, [])));
    // Selang-seling antar-sumber supaya hasil teratas tiap sumber muncul duluan.
    const out = [];
    for (let i = 0; i < 40; i++) for (const r of res) if (r[i]) out.push(r[i]);
    return out;
  });
}

export async function home() {
  return cached('home', 15 * MIN, async () => {
    const [popular, latest, manhwa, webtoons, english, shPopular] = await Promise.all([
      quiet(komiku.browse({ order: 'popular' }), 12000, []),
      quiet(komiku.browse({ order: 'latest' }), 12000, []),
      quiet(komiku.browse({ order: 'popular', type: 'manhwa' }), 12000, []),
      quiet(webtoon.browse({}), 12000, []),
      quiet(kakalot.browse({ order: 'popular' }), 12000, []),
      quiet(shinigami.browse({ order: 'popular' }), 8000, []),
    ]);
    return { popular: shPopular.length ? shPopular : popular, komikuPopular: popular, latest, manhwa, webtoons, english };
  });
}

export async function detail(id) {
  const { src, raw } = route(id);
  return cached('d:' + id, 15 * MIN, () => src.detail(raw));
}

export async function pages(id) {
  const { src, raw } = route(id);
  const list = await cached('p:' + id, 60 * MIN, () => src.pages(raw));
  if (!list.length) throw new SourceError('Halaman bab ini tidak ditemukan di sumber', 404);
  return list;
}

/** Judul yang sama di sumber lain (untuk pindah sumber bila bab kurang/rusak). */
export async function alternatives(id, title, alts = []) {
  const { src } = route(id);
  const names = [title, ...alts.filter((a) => a.replace(/\W/g, '').length >= 5)].filter(Boolean).slice(0, 2);
  const found = await Promise.all(Object.entries(SOURCES).filter(([, s]) => s !== src).map(async ([, s]) => {
    for (const n of names) {
      const hit = (await quiet(s.search(n), 10000, [])).find((m) => sameTitle(n, m.title, m.altTitles ?? []));
      if (hit) return hit;
    }
    return null;
  }));
  return found.filter(Boolean);
}
