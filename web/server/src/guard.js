// Perlindungan ringan tanpa dependensi: batas permintaan per IP (jendela tetap), kunci login sementara setelah
// banyak salah, dan header keamanan. Cukup untuk server pribadi; serangan besar (DDoS) tetap butuh Cloudflare.

/** Penghitung per kunci dalam jendela `windowMs`. */
export function limiter({ windowMs, max }) {
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs);
  sweep.unref?.();
  return {
    /** Tambah satu; kembalikan detik tunggu bila sudah lewat batas (0 = boleh). */
    hit(key, n = 1) {
      const now = Date.now();
      let v = hits.get(key);
      if (!v || v.reset <= now) { v = { count: 0, reset: now + windowMs }; hits.set(key, v); }
      v.count += n;
      return v.count > max ? Math.ceil((v.reset - now) / 1000) : 0;
    },
    blocked(key) {
      const v = hits.get(key);
      return v && v.reset > Date.now() && v.count > max ? Math.ceil((v.reset - Date.now()) / 1000) : 0;
    },
    reset(key) { hits.delete(key); },
  };
}

/** Middleware Express: tolak dengan 429 bila IP melewati batas. */
export function rateLimit(opts) {
  const l = limiter(opts);
  return (req, res, next) => {
    const wait = l.hit(req.ip || 'unknown');
    if (!wait) return next();
    res.setHeader('Retry-After', String(wait));
    res.status(429).json({ error: `Terlalu banyak permintaan, coba lagi ${wait} detik lagi` });
  };
}

export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'microphone=(self), camera=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  next();
}
