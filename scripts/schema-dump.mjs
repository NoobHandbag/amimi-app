// Aggiorna `supabase/schema.sql`, cioe' la STRUTTURA del database (tabelle, viste, funzioni,
// vincoli, permessi, RLS). E' la meta' che mancava ai backup.
//
// PERCHE' ESISTE (01-08): il backup giornaliero salva i DATI (`scripts/db-backup.mjs` + lo
// snapshot su Drive), e per la struttura si affidava alle migrazioni. Provando a ricostruire il
// database in locale si e' scoperto che le migrazioni NON ce la fanno: 4 file mancavano, 2 avevano
// lo stesso numero, 9 sono segnaposto di soli commenti, e comunque la `0050` ha una guardia che
// fa ROLLBACK su un database vuoto (giustamente: verifica che i conti del CE tornino).
// Quindi il replay delle migrazioni non e' una strada. Il dump dello schema si'.
//
// Nota sul piano Supabase: il progetto e' su piano FREE, che NON include i backup della
// piattaforma. L'unica rete di sicurezza e' quella che ci facciamo noi. Verificato il 01-08.
//
// USO:
//   node scripts/schema-dump.mjs
//
// Richiede: Docker acceso (il dump gira in un container), SUPABASE_ACCESS_TOKEN e
// SUPABASE_DB_PASSWORD nelle variabili d'ambiente, e il progetto collegato
// (`npx supabase link --project-ref imszbjeyplaiovylhkgl`).
//
// Il file prodotto e' ~143 KB e cambia solo quando cambia la struttura: va COMMITTATO nel repo.
// Cosi' lo storico e' infinito e ogni modifica strutturale si legge come un diff.
//
// RICOSTRUIRE UN DATABASE DA ZERO (restore o database di prova):
//   psql < supabase/schema.sql     -> la struttura
//   psql < supabase/seed.sql       -> dati finti minimi (per i test)
//   oppure i JSON di db-backup/    -> i dati veri (per un restore)

import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';

const OUT = 'supabase/schema.sql';
const need = ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD'].filter((k) => !process.env[k]);
if (need.length) {
  console.error(`STOP: mancano le variabili d'ambiente ${need.join(', ')}.`);
  process.exit(1);
}

console.log('Estrazione dello schema dalla produzione...');
try {
  execFileSync('npx', ['supabase', 'db', 'dump', '--linked', '-f', OUT], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: process.env,
    shell: true,
  });
} catch {
  console.error('\nDump fallito. Controlla che Docker sia acceso e che il progetto sia collegato:');
  console.error('  npx supabase link --project-ref imszbjeyplaiovylhkgl');
  process.exit(1);
}

const kb = Math.round(statSync(OUT).size / 1024);
console.log(`\nOK: ${OUT} aggiornato (${kb} KB).`);
console.log('Se il diff git non e\' vuoto, la struttura del database e\' cambiata: committa.');
