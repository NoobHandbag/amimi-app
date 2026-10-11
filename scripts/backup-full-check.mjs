// Guardia di completezza del backup COMPLETO (db-backup.yml, 2026-10-11).
// Il dump completo non ha un elenco di tabelle scritto a mano: prende tutto quello che c'e'. Questa guardia
// lo dimostra a ogni run: ogni tabella `public` dichiarata in schema.sql deve avere il suo blocco COPY in
// data.sql. Una tabella nuova entra nel backup da sola; se un giorno ne resta fuori una, la Action va in rosso.
//   node scripts/backup-full-check.mjs <schema.sql> <data.sql>
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Escluse apposta dal dump (`--exclude` in db-backup.yml): app_config tiene pin_hash e shopify_token.
export const EXCLUDED = ['app_config'];

export function tablesInSchema(sql) {
  return [...sql.matchAll(/^CREATE TABLE (?:IF NOT EXISTS )?"public"\."([^"]+)"/gm)].map((m) => m[1]);
}

export function tablesInData(sql) {
  return [...sql.matchAll(/^COPY "public"\."([^"]+)" \(/gm)].map((m) => m[1]);
}

export function missingTables(schemaSql, dataSql, excluded = EXCLUDED) {
  const have = new Set(tablesInData(dataSql));
  return tablesInSchema(schemaSql).filter((t) => !excluded.includes(t) && !have.has(t));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [schemaPath, dataPath] = process.argv.slice(2);
  if (!schemaPath || !dataPath) { console.error('uso: node scripts/backup-full-check.mjs <schema.sql> <data.sql>'); process.exit(2); }
  const schema = readFileSync(schemaPath, 'utf8'), data = readFileSync(dataPath, 'utf8');
  const all = tablesInSchema(schema), miss = missingTables(schema, data);
  console.log(`tabelle public nello schema: ${all.length}; nel dump: ${tablesInData(data).length}; escluse apposta: ${EXCLUDED.join(', ')}`);
  if (!all.length) { console.error('BACKUP COMPLETO NON VERIFICABILE: nessuna tabella trovata in schema.sql'); process.exit(1); }
  if (miss.length) { console.error('BACKUP COMPLETO INCOMPLETO, tabelle senza dati nel dump: ' + miss.join(', ')); process.exit(1); }
  console.log('backup completo: tutte le tabelle dello schema sono nel dump');
}
