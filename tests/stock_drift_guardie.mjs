// Guardie sul sorgente: v_stock_drift non mostra i codici di non_product_codici (GIFT_CARD), migr 0202.
// Run: node tests/stock_drift_guardie.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };

const definizioni = (dir) => readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => ({ f, sql: readFileSync(join(dir, f), 'utf8') }))
  .filter((x) => /create\s+(or\s+replace\s+)?view\s+("?public"?\.)?"?v_stock_drift\b/i.test(x.sql));
const corpo = (sql) => {
  const i = sql.search(/create\s+(or\s+replace\s+)?view\s+("?public"?\.)?"?v_stock_drift\b/i);
  return sql.slice(i, sql.indexOf(';', i));
};
const esclude = (c) => /where\s+not\s+exists\s*\(\s*select\s+1\s+from\s+non_product_codici\s+n\s+where\s+upper\(regexp_replace\(n\.codice,[^)]*\)\)\s*=\s*upper\(regexp_replace\(ss\.codice,[^)]*\)\)\s*\)\s*or\s+coalesce\(ss\.shopify_qty,\s*0\)\s*>\s*0$/i.test(c.trim());
const colonne = (c) => ['codice', 'shopify_title', 'shopify_qty', 'disponibili', 'conta_fresca', 'target_policy', 'delta', 'azione', 'synced_at']
  .filter((k) => !new RegExp(`(ss\\.|as\\s+)${k}\\b`, 'i').test(c));

const defs = definizioni(DIR);
const ultima = defs[defs.length - 1];
ok(defs.length >= 2, `v_stock_drift definita in ${defs.map((d) => d.f).join(', ')}`);
ok(esclude(corpo(ultima.sql)), `l'ultima definizione (${ultima.f}) esclude non_product_codici`);
ok(colonne(corpo(ultima.sql)).length === 0, `l'ultima definizione tiene le 9 colonne (mancanti: ${colonne(corpo(ultima.sql)).join(', ') || 'nessuna'})`);
ok(!esclude(corpo(ultima.sql).replace(/=\s*upper\(regexp_replace\(ss\.codice/i, '<> upper(regexp_replace(ss.codice'))
  && !esclude(corpo(ultima.sql).replace(/\s*or\s+coalesce\(ss\.shopify_qty[^;]*$/i, '')),
  'la guardia non passa se il confronto non e\' una uguaglianza normalizzata o se manca la clausola sulla quantita\' sopra zero');
ok(!/\b(insert|update|delete)\b[^;]*\bshopify_stock\b/i.test(ultima.sql), `${ultima.f} non scrive shopify_stock`);

// Autocontrollo: la guardia deve vedere il difetto sulla definizione di prima (0034, senza filtro).
const prima = defs.find((d) => d.f.startsWith('0034_'));
ok(!!prima && !esclude(corpo(prima.sql)), 'autocontrollo: la definizione della 0034 non passa la guardia');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
