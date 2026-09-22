// tests/edge_syntax.mjs — controllo di sintassi VERO delle edge (e di write-api/lib.ts).
//   node tests/edge_syntax.mjs
// Perche' esiste (22-09): con Node 24 `node --check file.ts` esce 0 anche su un file rotto quando il file
// contiene un `import` (misurato: `import ...; const y = 'rotto' qui';` -> exit 0). La Gate 1 lo usava sulle
// edge, quindi il controllo di sintassi non ha mai verificato nulla. Qui si passa dal parser TypeScript di Node
// (`module.stripTypeScriptTypes`), che lancia davvero sull'errore, piu' un caso rotto di autocontrollo.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

process.removeAllListeners('warning');
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FN = `${ROOT}supabase/functions`;
const files = readdirSync(FN, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(`${FN}/${d.name}/index.ts`)).map((d) => `${FN}/${d.name}/index.ts`);
if (existsSync(`${FN}/write-api/lib.ts`)) files.push(`${FN}/write-api/lib.ts`);

let ok = 0, ko = 0;
const parses = (src) => { try { stripTypeScriptTypes(src); return null; } catch (e) { return e.message.split('\n')[0]; } };
// autocontrollo: il rilevatore deve vedere un errore anche con un import in testa (il caso che `node --check` manca)
if (parses("import { x } from 'jsr:@supabase/supabase-js@2';\nconst y = 'rotto' qui';\n") === null) { console.log('  KO  autocontrollo: il parser non vede un errore evidente'); ko++; } else { ok++; console.log('  ok  autocontrollo: file rotto con import riconosciuto'); }
for (const f of files) {
  const err = parses(readFileSync(f, 'utf8'));
  const name = f.slice(FN.length + 1);
  if (err) { ko++; console.log(`  KO  ${name}  <- ${err}`); } else { ok++; console.log(`  ok  ${name}`); }
}
console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
