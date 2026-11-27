// tests/chiave_anthropic_guardie.mjs: cs-assist v36, cs-api v14 e ask-data v9 usano la chiave Anthropic della chat del sito.
// Controlli sul testo del sorgente, nessuna rete, nessuna chiave.
//   node tests/chiave_anthropic_guardie.mjs
// Perche' esiste: fino al 27-11-2026 cs-assist e cs-api cercavano la chiave in app_flags.anthropic_api_key, parcheggiata dal
// 31-07 come anthropic_api_key_disabled, quindi le bozze restavano su Gemini anche con il segreto ANTHROPIC_API_KEY attivo
// per la chat del sito e l'assistente. Dan ha deciso una chiave sola (stesso credito, stesso limite di spesa).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

process.removeAllListeners('warning');

const ROOT = fileURLToPath(new URL('../', import.meta.url));
// il codice senza i commenti di riga: i commenti raccontano la storia (app_flags, Gemini) e non devono far cadere i controlli
const codice = (f) => readFileSync(ROOT + f, 'utf8').replace(/\r\n/g, '\n').replace(/(^|[ \t])\/\/[^\n]*/gm, '$1');
const CS = codice('supabase/functions/cs-assist/index.ts');
const API = codice('supabase/functions/cs-api/index.ts');
const ASK = codice('supabase/functions/ask-data/index.ts');
const MIGR = readFileSync(ROOT + 'supabase/migrations/0216_cs_ai_model_claude_sonnet_5_5.sql', 'utf8');

let ok = 0, ko = 0;
const t = (n, c) => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n); } };
const ENV = /Deno\.env\.get\('ANTHROPIC_API_KEY'\)/;

console.log('\n== cs-assist ==');
t('chiave Claude dal segreto ANTHROPIC_API_KEY', /const claudeKey = \(Deno\.env\.get\('ANTHROPIC_API_KEY'\) \|\| ''\)\.trim\(\);/.test(CS));
t('anthropic_api_key non e\' piu\' letta da app_flags', !/anthropic_api_key/.test(CS));
t('modello di ripiego e allowlist dell\'override su claude-sonnet-5-5', /flags\.cs_ai_model_claude \|\| 'claude-sonnet-5-5'/.test(CS) && /MODEL_ALLOW = \['gemini-flash-latest', 'claude-sonnet-5-5'\]/.test(CS));
t('il ripiego su Gemini se Claude fallisce resta (v12)', /claudeFellBack = \(e as Error\)\.message/.test(CS));
t('Claude ha un tempo massimo, cosi\' il ripiego scatta anche se non risponde', /signal: AbortSignal\.timeout\(90_000\)/.test(CS));

console.log('\n== cs-api get_ai_config ==');
t('provider dalla presenza del segreto, stessa regola di cs-assist', ENV.test(API) && !/anthropic_api_key/.test(API));
t('modello di ripiego claude-sonnet-5-5', /m\.cs_ai_model_claude \|\| 'claude-sonnet-5-5'/.test(API));

console.log('\n== ask-data ==');
t('chiave dal segreto ANTHROPIC_API_KEY, chiave assente -> needs_key', ENV.test(ASK) && /needs_key: true/.test(ASK));
t('modello claude-sonnet-5-5 sull\'API Messages', /const MODEL = 'claude-sonnet-5-5';/.test(ASK) && /api\.anthropic\.com\/v1\/messages/.test(ASK));
t('nessuna traccia di Gemini ne\' di app_flags', !/gemini|generativelanguage|app_flags/i.test(ASK));
t('lo schema va nel system, la domanda nel messaggio', /system: SCHEMA/.test(ASK) && /content: `Domanda: \$\{question\}\\nSQL:`/.test(ASK));

const SRC_ASK = readFileSync(ROOT + 'supabase/functions/ask-data/index.ts', 'utf8').replace(/\r\n/g, '\n');
const cleanSql = new Function(stripTypeScriptTypes(SRC_ASK.match(/function cleanSql[\s\S]*?\n}/)[0]) + '\nreturn cleanSql;')();
t('cleanSql: blocco ```sql``` seguito da una nota -> solo la query', cleanSql('```sql\nSELECT 1;\n```\nNota: conta i pezzi') === 'SELECT 1');
t('cleanSql: query nuda invariata', cleanSql('SELECT 1') === 'SELECT 1');

console.log('\n== migr 0216 ==');
t('aggiorna solo il valore vecchio del flag', /update public\.app_flags set value = 'claude-sonnet-5-5'\s+where key = 'cs_ai_model_claude' and value = 'claude-sonnet-5';/.test(MIGR));

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
