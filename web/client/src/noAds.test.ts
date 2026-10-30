import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Penjaga: Freease harus 100% tanpa iklan. Player/iframe YouTube resmi bisa menayangkan iklan, jadi tidak
// boleh dipakai sama sekali; begitu juga skrip jaringan iklan apa pun. Berlaku untuk klien & server.
const FORBIDDEN = [
  /youtube(-nocookie)?\.com\/(embed|iframe_api|player_api)/i,
  /<iframe/i,
  /createElement\(\s*['"]iframe['"]/i,
  /doubleclick\.net|googlesyndication|adsbygoogle|googleadservices|googletagservices|google_ad|adservice\.google/i,
  /\bima3\.js\b|imasdk|\bvast\b.*\bxml\b/i,
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f === 'node_modules' || f === 'dist') return [];
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|jsx?|mjs|css|html)$/.test(f) && !/\.test\.[tj]s$/.test(f) ? [p] : [];
  });
}

describe('100% tanpa iklan', () => {
  it('tidak ada player YouTube resmi, iframe, atau skrip iklan', () => {
    const bad: string[] = [];
    for (const f of [...files('src'), 'index.html', 'vite.config.ts', ...files('../server/src')]) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        for (const re of FORBIDDEN) if (re.test(line)) bad.push(`${f}:${i + 1} ${line.trim().slice(0, 100)}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
