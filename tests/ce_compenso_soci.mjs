// tests/ce_compenso_soci.mjs — guardie sul SORGENTE per la riga "compenso soci" del CE (migr 0154, 13-10-2026).
//   node tests/ce_compenso_soci.mjs
//
// La riga e' un costo VARIABILE calcolato nelle viste (2,5% delle vendite nette, accordo socio). Vive in sei posti che
// devono restare d'accordo: le viste (MC1/MC2), l'invariante di ce-guard (se manca, ce_invarianti_mc suona su ogni mese),
// la griglia del CE dettagliato (riga + totale costi variabili), il Dettaglio mese del Cruscotto, il backup (senza la
// tabella parametri un restore azzera il compenso e manda in drift i mesi chiusi) e lo scope di default (Totale, richiesta
// owner 13-10). Le verifiche sui NUMERI in produzione stanno in tests/features.mjs (sola lettura).
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + String(extra).slice(0, 160) : '')); } };

console.log('\n== migrazione 0154 ==');
{
  const p = 'supabase/migrations/0154_ce_compenso_soci.sql';
  t('il file esiste', existsSync(ROOT + p));
  const M = existsSync(ROOT + p) ? read(p) : '';
  const mc1 = /omni_netto \+ cogs \+ packaging \+ commissioni \+ logistica_var \+ resi \+ compenso_soci AS mc1/g;
  t('MC1 delle due summary include compenso_soci', (M.match(mc1) || []).length === 2);
  t('MC2 delle due summary include compenso_soci', (M.match(/resi \+ compenso_soci \+ salari \+ tasse \+ logistica_mag \+ opex \+ eventi \+ marketing AS mc2/g) || []).length === 2);
  t('v_ce_totale: mc1 e mc2 ricalcolati col compenso', /t\.mc1 \+ c\.compenso_soci as mc1/.test(M) && /t\.mc2 \+ c\.compenso_soci as mc2/.test(M));
  t('base del Totale senza omaggi (vendita_manuale resta)', /kind is distinct from ''vendita_manuale''/.test(M));
  t('base mai negativa (greatest ..., 0)', (M.match(/greatest\(/g) || []).length >= 3);
  t('le viste si avvolgono da pg_get_viewdef, non si ribattono', (M.match(/pg_get_viewdef\('public\.v_ce_(amimi|totale)'/g) || []).length === 2);
  t('guardia pre-reclose: netto identico e mc2 sceso del solo compenso', /delta_mc2 - round\(c\.compenso_soci, 2\)/.test(M));
  t('audit in change_log prima della sovrascrittura', /insert into change_log[\s\S]*reclose-compenso-soci[\s\S]*update ce_snapshots/.test(M));
  t('guardia post-reclose: drift 0', /dopo la ri-chiusura restano/.test(M));
  t('funzione aliquota SECURITY DEFINER con search_path fisso', /security definer set search_path = public/.test(M));
  t('grant ad ask_ro (ask-data, assistant, MCP)', /grant execute on function public\.ce_aliquota_compensi\(int, int\) to ask_ro/.test(M));
}

console.log('\n== ce-guard: invariante MC1 ==');
{
  const G = read('supabase/functions/ce-guard/index.ts');
  t('mc1c somma anche compenso_soci', /const mc1c = [^\n]*N\(r\.resi\) \+ N\(r\.compenso_soci\)/.test(G));
}

console.log('\n== frontend ==');
{
  const A = read('web/src/lib/api.ts');
  t('CE_COLS chiede base_compenso_soci e compenso_soci', /const CE_COLS = '[^']*,base_compenso_soci,compenso_soci'/.test(A));
  const D = read('web/src/pages/CeDetail.tsx');
  t('CE dettagliato: riga compenso_soci fra i costi variabili (dopo resi, prima del totale)',
    /k: 'resi'[^\n]*\n\s*\{ k: 'compenso_soci'[^\n]*\n\s*\{ k: 'var_tot'/.test(D));
  t('CE dettagliato: il totale costi variabili include il compenso', /case 'var_tot': return [^\n]*r\.compenso_soci;/.test(D));
  t('CE dettagliato: scope di default Totale', /const \[scope, setScope\] = useState<Scope>\('totale'\)/.test(D));
  const R = read('web/src/pages/Report.tsx');
  t('Cruscotto: scope di default Totale', /const \[scope, setScope\] = useState<Scope>\('totale'\)/.test(R));
  t('Cruscotto: Dettaglio mese anche in Totale (non piu\' solo Amimi)', !/scope === 'amimi' && \(\s*\n\s*<section className="card">\s*\n\s*<div className="dethead">/.test(R) && /const detRows = scope === 'amimi'/.test(R));
  t('Cruscotto: riga Compenso soci nel Dettaglio mese', /<DetRow label="Compenso soci[^"]*" v=\{dm\.compenso_soci/.test(R));
}

console.log('\n== backup ==');
{
  const B = read('scripts/db-backup.mjs');
  t('db-backup copia ce_compensi_soci', /'ce_compensi_soci'/.test(B));
}

console.log(`\n${ok} ok, ${ko} KO`);
if (ko) process.exit(1);
