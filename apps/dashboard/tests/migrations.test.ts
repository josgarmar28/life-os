// En Supabase, pg_safeupdate rechaza UPDATE y DELETE sin WHERE en las llamadas por la API, y en las
// pruebas locales no existe. Esta prueba lo detecta antes de desplegar.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(__dirname, '../../../supabase/migrations');
// La versión vigente de cada función es la última migración que la define.
const latest = new Map<string, { file: string; body: string }>();
for (const file of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) {
  const sql = readFileSync(join(DIR, file), 'utf8');
  for (const m of sql.matchAll(/create (?:or replace )?function ([a-z_]+\.[a-z_]+)\([^$]*?\$\$([\s\S]*?)\$\$/gi)) {
    latest.set(m[1].toLowerCase(), { file, body: m[2] });
  }
}

describe('migraciones', () => {
  it('ninguna función hace UPDATE o DELETE sin WHERE', () => {
    const bad: string[] = [];
    for (const [fn, { file, body }] of latest) {
      for (const st of body.matchAll(/\b(update\s+[a-z_]+\.[a-z_]+\s+set|delete\s+from)\b[^;]*;/gi)) {
        if (!/\bwhere\b/i.test(st[0])) bad.push(`${fn} (${file}): ${st[0].replace(/\s+/g, ' ').slice(0, 80)}`);
      }
    }
    expect(latest.size).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });
});
