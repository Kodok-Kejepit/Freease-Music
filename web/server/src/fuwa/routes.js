// Rute API Freease Stream (/api/fs/...): anime (Animekompi + Otakudesu), donghua (Anichin), manga/manhwa/manhua, proxy video & gambar.
import * as A from './anime.js';
import * as M from './manga.js';
import { mountMedia } from './media.js';
import { quiet } from './net.js';

const wrap = (maxAge, fn) => async (req, res) => {
  try {
    const out = await fn(req, res);
    if (res.headersSent) return;
    res.setHeader('cache-control', `private, max-age=${maxAge}`);
    res.json(out);
  } catch (e) {
    console.error('fs', req.path, e.message);
    if (!res.headersSent) res.status(e.status && e.status < 600 ? e.status : 502).json({ error: e.message || 'Sumber sedang bermasalah' });
  }
};
const str = (v, n = 200) => String(v ?? '').trim().slice(0, n);

export function mountStream(app) {
  mountMedia(app);

  app.get('/api/fs/anime/home', wrap(180, () => A.home()));
  app.get('/api/fs/donghua/home', wrap(180, () => A.donghuaHome()));
  app.get('/api/fs/anime/browse', wrap(300, (req) => A.browse({
    order: str(req.query.order, 20), page: Number(req.query.page) || 1, genre: str(req.query.genre, 40) || undefined,
    type: str(req.query.type, 20) || undefined, status: str(req.query.status, 20) || undefined,
    source: ['od', 'ac'].includes(req.query.source) ? req.query.source : undefined,
  })));
  app.get('/api/fs/anime/sources', wrap(86400, () => A.SOURCES));
  app.get('/api/fs/anime/alternatives', wrap(1800, (req) => {
    const alts = Array.isArray(req.query.alt) ? req.query.alt : req.query.alt ? [req.query.alt] : [];
    return A.alternatives(str(req.query.id, 220), str(req.query.title, 200), alts.map((a) => str(a, 200)).slice(0, 3));
  }));
  app.get('/api/fs/anime/latest', wrap(180, (req) => A.latestEpisodes(Number(req.query.page) || 1)));
  app.get('/api/fs/anime/search', wrap(600, (req) => A.search(str(req.query.q, 100))));
  app.get('/api/fs/anime/genres', wrap(21600, (req) => A.genres(['od', 'ac'].includes(req.query.source) ? req.query.source : undefined)));
  app.get('/api/fs/anime/schedule', wrap(900, (req) => A.schedule(req.query.kind === 'donghua' ? 'donghua' : undefined)));
  app.get('/api/fs/anime/:id', wrap(300, (req) => A.detail(req.params.id)));
  // Tautan video kedaluwarsa dalam ±1 jam: jangan disimpan browser lama-lama.
  app.get('/api/fs/episode/:id', wrap(60, (req) => A.episode(req.params.id)));
  app.get('/api/fs/episode-elsewhere', wrap(60, (req) => {
    const alts = Array.isArray(req.query.alt) ? req.query.alt : req.query.alt ? [req.query.alt] : [];
    return A.episodeElsewhere(str(req.query.id, 220), str(req.query.title, 200), alts.map((a) => str(a, 200)).slice(0, 3), str(req.query.n, 20));
  }));

  app.get('/api/fs/manga/home', wrap(600, () => M.home()));
  app.get('/api/fs/manga/sources', wrap(86400, () => M.SOURCE_LIST));
  app.get('/api/fs/manga/browse/:source', wrap(600, (req) => M.browse(req.params.source, {
    order: req.query.order === 'latest' ? 'latest' : 'popular', page: Number(req.query.page) || 1,
    type: str(req.query.type, 20) || undefined, genre: str(req.query.genre, 40) || undefined,
  })));
  app.get('/api/fs/manga/search', wrap(600, (req) => M.search(str(req.query.q, 100), ['id', 'en'].includes(req.query.lang) ? req.query.lang : undefined)));
  app.get('/api/fs/manga/detail', wrap(600, (req) => M.detail(str(req.query.id, 420))));
  app.get('/api/fs/manga/pages', wrap(3600, (req) => M.pages(str(req.query.id, 420))));
  app.get('/api/fs/manga/alternatives', wrap(1800, async (req) => {
    const alts = Array.isArray(req.query.alt) ? req.query.alt : req.query.alt ? [req.query.alt] : [];
    return M.alternatives(str(req.query.id, 420), str(req.query.title, 200), alts.map((a) => str(a, 200)).slice(0, 3));
  }));

  /** Satu kotak cari untuk anime & komik sekaligus. */
  app.get('/api/fs/search', wrap(600, async (req) => {
    const q = str(req.query.q, 100);
    const [anime, manga] = await Promise.all([quiet(A.search(q), 12000, []), quiet(M.search(q), 15000, [])]);
    return { anime, manga };
  }));

  app.use('/api/fs', (req, res) => res.status(404).json({ error: 'Tidak ada' }));
}
