// tests/iva_fuori_ce.mjs — guardie sul SORGENTE per l'IVA versata fuori dal CE (migr 0173, 26-10-2026).
//   node tests/iva_fuori_ce.mjs
//
// I ricavi del CE sono netti (lordo / 1,22): la quota IVA di un F24 (TASSE / 'IVA') non deve entrare in MC2, altrimenti
// l'IVA si toglie due volte. La regola vive in quattro posti che devono restare d'accordo: le due viste CE (riga tasse),
// il drill-down (nessuna riga CE per l'IVA), v_ce_completezza (esclusione dichiarata, altrimenti ce_completezza_spese
// suona su ogni mese con IVA) e ce-guard (WARN sugli F24 non ancora divisi).
import { readFileSync } from 'node:fs';

const MIG = readFileSync(new URL('../supabase/migrations/0173_iva_versata_fuori_ce.sql', import.meta.url), 'utf8');
const GUARD = readFileSync(new URL('../supabase/functions/ce-guard/index.ts', import.meta.url), 'utf8');

let fail = 0;
const ok = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) fail++; };

ok('viste CE: il filtro tasse esclude la sottocategoria IVA, su v_ce_amimi e v_ce_totale',
  /array\['v_ce_amimi', 'v_ce_totale'\]/.test(MIG) && /sottocategoria IS DISTINCT FROM 'IVA'::text/.test(MIG));
ok('viste CE: la sostituzione si ferma se il filtro non compare esattamente una volta',
  /non compare esattamente una volta/.test(MIG));
ok('drill-down: TASSE/IVA prima di TASSE, con ce_line null',
  /sottocategoria = 'IVA' then null\s+when categoria = 'TASSE' then 'tasse'/.test(MIG));
ok('completezza: IVA versata e\' un\'esclusione dichiarata dentro spese_scoperte e in colonna visibile',
  /\+ coalesce\(sp\.iva_versata, 0\)\), 2\) as spese_scoperte/.test(MIG) && /as spese_iva_escluse/.test(MIG));
ok('completezza: la nuova colonna sta in coda (create or replace view non sposta colonne)',
  /as spese_scoperte,\s+round\(coalesce\(sp\.iva_versata, 0\), 2\) as spese_iva_escluse\s+from mesi_nativi/.test(MIG));
ok('vista da dividere: ignora IVA, Ritenute, Diritti e bolli; niente anon',
  /not in \('IVA', 'Ritenute', 'Diritti e bolli'\)/.test(MIG) && /revoke all on public\.v_tasse_iva_da_dividere from anon/.test(MIG));
ok('ri-chiusura: guardia prima (solo tasse e mc2 di apr-giu) e dopo (snapshot uguali al live), change_log',
  /amimi-4:mc2 236\.57/.test(MIG) && /dopo la ri-chiusura restano righe diverse/.test(MIG) && /'reclose'/.test(MIG));
ok('giugno: 1305,39 IVA + 543,60 ritenute = 1848,99 dell\'F24',
  Math.abs(1305.39 + 543.60 - 1848.99) < 0.005 && /-1305\.39/.test(MIG) && /-543\.60, 'TASSE', 'Ritenute'/.test(MIG));
ok('ce-guard: check WARN ce_tasse_iva_da_dividere sulla vista',
  /from\('v_tasse_iva_da_dividere'\)/.test(GUARD) && /add\('ce_tasse_iva_da_dividere'[\s\S]{0,400}'warn'\)/.test(GUARD));

if (fail) { console.error(`\n${fail} guardie fallite`); process.exit(1); }
console.log('\ntutte le guardie ok');
