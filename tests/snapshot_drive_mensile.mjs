// tests/snapshot_drive_mensile.mjs: il backup mensile PERMANENTE (2026-10-11): la copia su Drive
// (scripts/appsscript-snapshot/Snapshot.js) e la guardia di completezza del dump completo
// (scripts/backup-full-check.mjs). Lo script Drive e' Apps Script (niente export): lo si carica in un contesto vm
// con Drive, UrlFetch e Mail finti. Fissa: il primo foglio di ogni mese non viene mai cestinato, i tag dei mesi a
// cavallo d'anno, la copia dei due archivi mancanti senza doppioni, la mail solo per il mese corrente dal giorno 3,
// e che una tabella nuova rimasta fuori dal dump fa fallire la guardia.
//   node tests/snapshot_drive_mensile.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { tablesInSchema, tablesInData, missingTables } from '../scripts/backup-full-check.mjs';

let ok = 0, ko = 0;
const eq = (name, got, exp) => {
  const g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g === e) { ok++; console.log('  ok  ' + name); }
  else { ko++; console.log(`  KO  ${name}  atteso ${e}, ottenuto ${g}`); }
};

const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
const mkFile = (name) => ({ name, trashed: false, getName() { return this.name; }, setTrashed(v) { this.trashed = v; } });
const mkFolder = (files = []) => ({
  files, sub: {},
  getFiles() { return iter(this.files); },
  getFilesByName(n) { return iter(this.files.filter((f) => f.name === n)); },
  getFoldersByName(n) { return iter(this.sub[n] ? [this.sub[n]] : []); },
  createFolder(n) { return (this.sub[n] = mkFolder()); },
  createFile(blob) { const f = mkFile(blob.name); this.files.push(f); return f; },
});

// released = nomi degli asset per cui GitHub risponde 200; gli altri 404
const load = (released) => {
  const fetched = [], mails = [];
  const ctx = vm.createContext({
    UrlFetchApp: {
      fetch(url) {
        fetched.push(url);
        const hit = released.some((n) => url.endsWith('/' + n));
        const blob = { name: '', getBytes: () => (hit ? [1, 2, 3] : []), setName(n) { this.name = n; return this; } };
        return { getResponseCode: () => (hit ? 200 : 404), getBlob: () => blob };
      },
    },
    MailApp: { sendEmail: (...a) => mails.push(a) },
  });
  vm.runInContext(readFileSync(new URL('../scripts/appsscript-snapshot/Snapshot.js', import.meta.url), 'utf8'), ctx);
  return { ctx, fetched, mails };
};

console.log('\n== tag dei mesi, anche a cavallo d\'anno ==');
{
  const { ctx } = load([]);
  eq('ottobre, 3 mesi', ctx.monthTags_('2026-10-11', 3), ['backup-2026-10', 'backup-2026-09', 'backup-2026-08']);
  eq('gennaio, 3 mesi', ctx.monthTags_('2027-01-02', 3), ['backup-2027-01', 'backup-2026-12', 'backup-2026-11']);
}

console.log('\n== la retention non tocca il primo foglio di ogni mese ==');
{
  const { ctx } = load([]);
  // agosto ha il giorno 01; a settembre lo script il giorno 01 non ha girato: vale il 03
  const folder = mkFolder(['2026-08-01', '2026-08-02', '2026-09-03', '2026-09-04', '2026-09-20', '2026-10-01', '2026-10-10']
    .map((d) => mkFile('Amimi_App_Snapshot_' + d)).concat(mkFile('altro file')));
  ctx.cleanupOld_(folder, '2026-10-11');
  eq('cestinati solo i giornalieri oltre i 30 giorni',
    folder.files.filter((f) => f.trashed).map((f) => f.name), ['Amimi_App_Snapshot_2026-08-02', 'Amimi_App_Snapshot_2026-09-04']);
  ctx.cleanupOld_(folder, '2027-03-01');
  eq('dopo mesi restano i tre primi-del-mese',
    folder.files.filter((f) => !f.trashed).map((f) => f.name),
    ['Amimi_App_Snapshot_2026-08-01', 'Amimi_App_Snapshot_2026-09-03', 'Amimi_App_Snapshot_2026-10-01', 'altro file']);
}

console.log('\n== copia dei due archivi mancanti, senza doppioni ==');
{
  const { ctx, fetched } = load(['amimi-backup-2026-10.tar.gz', 'amimi-backup-2026-10-full.tar.gz.gpg', 'amimi-backup-2026-09.tar.gz']);
  const folder = mkFolder();
  const missing = ctx.archiveMonthly_(folder, '2026-10-11');
  const dest = folder.sub['Mensili (permanenti)'];
  eq('copiati i file che esistono', dest.files.map((f) => f.name),
    ['amimi-backup-2026-10.tar.gz', 'amimi-backup-2026-10-full.tar.gz.gpg', 'amimi-backup-2026-09.tar.gz']);
  eq('gli altri tornano come mancanti, col tag in testa', missing, [
    'backup-2026-09: amimi-backup-2026-09-full.tar.gz.gpg (HTTP 404)',
    'backup-2026-08: amimi-backup-2026-08.tar.gz (HTTP 404)',
    'backup-2026-08: amimi-backup-2026-08-full.tar.gz.gpg (HTTP 404)',
  ]);
  eq('mancano solo mesi vecchi: niente mail', ctx.monthlyAlertDue_('2026-10-11', missing), false);
  const before = fetched.length;
  ctx.archiveMonthly_(folder, '2026-10-12');
  eq('secondo giro: riprova solo i mancanti, nessun doppione', [fetched.length - before, dest.files.length], [3, 3]);
}

console.log('\n== mail solo per il mese corrente, dal giorno 3 ==');
{
  const { ctx } = load([]);
  const cur = ['backup-2026-11: amimi-backup-2026-11-full.tar.gz.gpg (HTTP 404)'];
  eq('giorno 1, mese corrente mancante: niente mail', ctx.monthlyAlertDue_('2026-11-01', cur), false);
  eq('giorno 2: niente mail', ctx.monthlyAlertDue_('2026-11-02', cur), false);
  eq('giorno 3: mail', ctx.monthlyAlertDue_('2026-11-03', cur), true);
  eq('manca solo un mese vecchio: niente mail', ctx.monthlyAlertDue_('2026-11-15', ['backup-2026-09: amimi-backup-2026-09.tar.gz (HTTP 404)']), false);
  eq('eccezione: mail', ctx.monthlyAlertDue_('2026-11-15', ['errore: Drive giu']), true);
  eq('niente mancante: niente mail', ctx.monthlyAlertDue_('2026-11-15', []), false);
}

console.log('\n== guardia di completezza del dump completo ==');
{
  const schema = [
    'CREATE TABLE IF NOT EXISTS "public"."products" (', 'CREATE TABLE IF NOT EXISTS "public"."app_config" (',
    'CREATE TABLE "public"."tabella_nata_domani" (', 'CREATE TABLE IF NOT EXISTS "auth"."users" (',
  ].join('\n    "id" integer\n);\n');
  const data = 'COPY "public"."products" ("id") FROM stdin;\n1\n\\.\n';
  eq('tabelle public dello schema', tablesInSchema(schema), ['products', 'app_config', 'tabella_nata_domani']);
  eq('tabelle nel dump', tablesInData(data), ['products']);
  eq('una tabella nuova fuori dal dump viene vista; app_config e\' esclusa apposta', missingTables(schema, data), ['tabella_nata_domani']);
  eq('dump completo: niente mancante',
    missingTables(schema, data + 'COPY "public"."tabella_nata_domani" ("id") FROM stdin;\n\\.\n'), []);
}

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
