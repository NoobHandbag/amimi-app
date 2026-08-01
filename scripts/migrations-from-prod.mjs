// Rigenera la storia delle migrazioni dal DB di PRODUZIONE, che e' l'unica fonte completa.
//
// PERCHE' ESISTE (scoperto il 2026-08-01 provando a ricostruire il DB in locale con Docker):
// `supabase/migrations/` NON e' in grado di ricreare il database. Tre problemi cumulativi:
//   1. mancavano 4 file (0008, 0009, 0010, 0052) -> recuperati a mano il 01-08;
//   2. due file avevano lo STESSO numero (0026) -> il CLI va in errore di chiave duplicata;
//   3. 9 file sono SEGNAPOSTO di soli commenti: il corpo vero fu applicato via MCP e nel repo
//      resto' solo una nota ("Full body applied via MCP; identical to the live view").
// Conseguenza: la procedura di restore descritta in `scripts/db-backup.mjs` ("ricrea lo schema
// dalle migrazioni, poi reinserisci i JSON") NON avrebbe funzionato. I dati erano salvi, lo
// stampo per ricostruirci attorno il database no.
//
// Il DB di produzione conserva il testo di OGNI migrazione applicata in
// `supabase_migrations.schema_migrations.statements`: 105 righe complete. Questo script le
// scarica e le scrive su file, in ordine di versione.
//
// USO:
//   node scripts/migrations-from-prod.mjs                 -> scrive in supabase/migrations_prod/
//   node scripts/migrations-from-prod.mjs --out <cartella>
//
// NON sovrascrive `supabase/migrations/`: scrive in una cartella separata, cosi' il confronto e
// l'eventuale sostituzione restano una decisione umana.
//
// Richiede SUPABASE_ACCESS_TOKEN (lo stesso che usa la CLI). Usa la Management API, quindi il
// contenuto non passa da nessuna parte se non dal disco.

const REF = process.env.AMIMI_PROJECT_REF || 'imszbjeyplaiovylhkgl';
const TOKEN = (process.env.SUPABASE_ACCESS_TOKEN || '').trim();
if (!TOKEN) {
  console.error('STOP: manca SUPABASE_ACCESS_TOKEN (la variabile che usa anche la CLI Supabase).');
  process.exit(1);
}

const outIdx = process.argv.indexOf('--out');
const OUT = outIdx > -1 ? process.argv[outIdx + 1] : 'supabase/migrations_prod';

const { mkdirSync, writeFileSync, readdirSync } = await import('node:fs');
const { join } = await import('node:path');

async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`Management API ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

// `statements` e' un array: si ricompone con un ';' finale per ogni statement, come lo applicava il CLI.
const rows = await q(`
  select version, name, array_to_string(statements, E';\\n') as sql
  from supabase_migrations.schema_migrations
  order by version
`);

mkdirSync(OUT, { recursive: true });
let scritti = 0, vuoti = 0;
for (const r of rows) {
  const nome = String(r.name || 'senza_nome').replace(/[^A-Za-z0-9_-]/g, '_');
  const corpo = (r.sql || '').trim();
  if (!corpo) { vuoti++; continue; }
  const testata =
    `-- ${r.name}\n` +
    `-- Versione applicata in produzione: ${r.version}\n` +
    `-- Rigenerata da supabase_migrations.schema_migrations (fonte autoritativa).\n\n`;
  writeFileSync(join(OUT, `${r.version}_${nome}.sql`), testata + corpo + (corpo.endsWith(';') ? '' : ';') + '\n', 'utf8');
  scritti++;
}

const nelRepo = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).length;
console.log(`migrazioni in produzione : ${rows.length}`);
console.log(`file scritti in ${OUT} : ${scritti}${vuoti ? ` (${vuoti} senza corpo, saltate)` : ''}`);
console.log(`file oggi in supabase/migrations : ${nelRepo}`);
console.log('\nNIENTE e\' stato sovrascritto. Confronta le due cartelle prima di decidere.');
