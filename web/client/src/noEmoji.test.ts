import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Penjaga: teks yang tampil tidak boleh memakai emoji/simbol pengganti ikon — pakai ikon (lucide).
// Komentar diabaikan; "→" (petunjuk menu) dan "♪" (penanda baris instrumental di data lirik) diizinkan.
const PATTERN = /[←-⇿⌀-⏿①-➿⤀-⥿⬀-⯿〰〽㊗㊙️]|\p{Extended_Pictographic}/gu;
const ALLOWED = new Set(['→', '♪', '←', '↑', '↓']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|css|html)$/.test(f) && !f.endsWith('.test.ts') ? [p] : [];
  });
}

describe('tanpa emoji mentah', () => {
  it('teks aplikasi bebas emoji', () => {
    const bad: string[] = [];
    for (const f of [...files('src'), 'index.html']) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('<!--')) return;
        const found = (line.match(PATTERN) ?? []).filter((x) => !ALLOWED.has(x));
        if (found.length) bad.push(`${f}:${i + 1} ${found.join('')}`);
      });
    }
    expect(bad).toEqual([]);
  });
});
