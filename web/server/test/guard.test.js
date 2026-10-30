import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { limiter } from '../src/guard.js';

test('limiter: lolos sampai batas, lalu minta tunggu', () => {
  const l = limiter({ windowMs: 60_000, max: 3 });
  assert.equal(l.hit('a'), 0); assert.equal(l.hit('a'), 0); assert.equal(l.hit('a'), 0);
  assert.ok(l.hit('a') > 0);
  assert.equal(l.hit('b'), 0, 'IP lain tidak ikut terkunci');
  l.reset('a');
  assert.equal(l.hit('a'), 0);
});

test('server: login dikunci setelah 8 kali salah, X-Forwarded-For palsu tidak menolong', async (t) => {
  const port = 18000 + Math.floor(Math.random() * 1000);
  const srv = spawn(process.execPath, ['src/server.js'], { env: { ...process.env, PORT: String(port), FREEASE_PASSWORD: 'benar123', TRUST_PROXY: 'false', CLIENT_DIR: '/nonexistent' }, stdio: 'ignore' });
  t.after(() => srv.kill());
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) { try { await fetch(`${url}/api/config`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const login = (pw, ip) => fetch(`${url}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', ...(ip ? { 'x-forwarded-for': ip } : {}) }, body: JSON.stringify({ password: pw }) });
  for (let i = 0; i < 8; i++) assert.equal((await login('salah', `1.2.3.${i}`)).status, 401);
  assert.equal((await login('salah')).status, 429);
  assert.equal((await login('benar123', '9.9.9.9')).status, 429, 'kata sandi benar pun ditolak selama dikunci');
  const h = await fetch(`${url}/api/config`);
  assert.equal(h.headers.get('x-content-type-options'), 'nosniff');
});
