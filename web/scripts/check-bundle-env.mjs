// Secondo anello della rete di sicurezza (brief frontend_rete_di_sicurezza, parte 1): PRIMA di
// pubblicare, controlla che il bundle appena costruito contenga davvero l'host Supabase.
// La guardia in vite.config ferma la build senza env; questo ferma la PUBBLICAZIONE di un dist
// vecchio, parziale o costruito altrove. Gira come `predeploy`, quindi non si puo' dimenticare.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath e non .pathname: il percorso del progetto contiene spazi ("GESTIONALE AMI CLAUDE")
// e in un URL arrivano come %20, quindi existsSync direbbe sempre "non c'e'" (preso al primo giro).
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const ENVF = fileURLToPath(new URL('../.env.local', import.meta.url));

const stop = (msg) => { console.error('\nPUBBLICAZIONE FERMATA: ' + msg + '\n'); process.exit(1); };

if (!existsSync(DIST)) stop('manca web/dist. Lancia prima `npm run build`.');

const envRaw = existsSync(ENVF) ? readFileSync(ENVF, 'utf8') : '';
const url = (process.env.VITE_SUPABASE_URL || (envRaw.match(/^VITE_SUPABASE_URL\s*=\s*(.+)$/m)?.[1] ?? '')).trim();
if (!url) stop('VITE_SUPABASE_URL non trovata ne in ambiente ne in web/.env.local: non ho un riferimento con cui controllare il bundle.');
const host = url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');

const assets = join(DIST, 'assets');
if (!existsSync(assets)) stop('manca web/dist/assets: il bundle non e stato costruito.');
const js = readdirSync(assets).filter((f) => f.endsWith('.js'));
if (!js.length) stop('nessun file .js in web/dist/assets.');

const trovato = js.some((f) => readFileSync(join(assets, f), 'utf8').includes(host));
if (!trovato) stop(`l'host Supabase "${host}" NON compare in nessuno dei ${js.length} bundle di web/dist/assets.\n` +
  'Vuol dire che il dist e stato costruito senza env: pubblicarlo darebbe schermate bianche su TUTTA l app.\n' +
  'Ricostruisci con `npm run build` dopo aver messo a posto web/.env.local.');

console.log(`check bundle: ok, "${host}" presente in ${js.length} file di dist/assets`);

// Terzo anello (brief cs_crop_residui_e_versione, parte 2): l'avviso "versione nuova" si regge tutto
// su dist/version.json. Se quel file manca o punta a un chunk che non e' nel dist, l'avviso non
// compare MAI e nessuno se ne accorge, perche' il modo di scoprirlo sarebbe proprio l'avviso.
// Peggio: le schede gia' aperte non si auto-guariscono. Qui la pubblicazione si ferma.
// Il controllo e' PER CONTENUTO e non con una regex sull'HTML: una regex sul tag <script> dipende
// dall'ordine degli attributi e si romperebbe in silenzio a un cambio di vite.
const VERF = join(DIST, 'version.json');
if (!existsSync(VERF)) stop('manca dist/version.json: senza, l app non sapra mai che e uscita una versione nuova.\n' +
  'Lo genera il plugin `amimi-versione` in vite.config.ts: ricostruisci con `npm run build`.');
let ver;
try { ver = JSON.parse(readFileSync(VERF, 'utf8')); }
catch { stop('dist/version.json non e JSON valido.'); }
if (!Number.isFinite(ver.build) || ver.build <= 0) stop('dist/version.json senza `build` numerico: il confronto fra versioni non puo funzionare.');
if (!ver.entry) stop('dist/version.json senza `entry`: non so quale chunk sia quello di ingresso.');
if (!existsSync(join(DIST, ver.entry))) stop(`dist/version.json dichiara l entry "${ver.entry}" che in dist NON esiste.`);
const indexHtml = readFileSync(join(DIST, 'index.html'), 'utf8');
if (!indexHtml.includes(ver.entry)) stop(`dist/index.html non carica l entry "${ver.entry}" dichiarata da version.json: i due file vengono da build diverse.`);
console.log(`check versione: ok, build ${ver.build} (${ver.label}), entry ${ver.entry}`);
