// tests/ce_rettifiche.mjs — guardie sul SORGENTE per le rettifiche del CE e le imposte stimate (migr 0212 e 0213, 25-11-2026).
//   node tests/ce_rettifiche.mjs
//
// Il COGS dei mesi passati si corregge con righe di ce_rettifiche, non riscrivendo i cogs_snapshot delle vendite. La regola
// vive in sei posti che devono restare d'accordo: le due viste CE (cogs e logistica_var), i due drill, v_ce_completezza
// (una rettifica non e' una spesa), la ri-chiusura dei mesi chiusi e il frontend. Le imposte stimate restano FUORI da
// mc1, mc2 e dalla base del compenso soci (decisione di Dan del 25-11).
import { readFileSync } from 'node:fs';

const M12 = readFileSync(new URL('../supabase/migrations/0212_ce_rettifiche_e_imposte_stimate.sql', import.meta.url), 'utf8');
const M13 = readFileSync(new URL('../supabase/migrations/0213_cogs_materiali_rettifica_e_richiusura.sql', import.meta.url), 'utf8');
const API = readFileSync(new URL('../web/src/lib/api.ts', import.meta.url), 'utf8');
const CE = readFileSync(new URL('../web/src/pages/CeDetail.tsx', import.meta.url), 'utf8');

let fail = 0;
const ok = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) fail++; };

// 0212: struttura, CE identico
ok('0212: ce_rettifiche nasce vuota e i mesi chiusi non si muovono (guardia in fondo)',
  /ce_rettifiche deve nascere vuota/.test(M12) && /i mesi chiusi si muovono senza rettifiche/.test(M12));
ok('0212: ogni sostituzione nelle viste si ferma se il pezzo non compare esattamente una volta (totale, amimi, completezza)',
  (M12.match(/non compare esattamente una volta/g) || []).length === 3);
ok('0212: v_ce_totale somma rt.cogs e rt.logistica_var, v_ce_amimi solo le righe in_amimi',
  /AS cogs', 'COALESCE\(m\.cogs, \(0\)::numeric\)\) \+ COALESCE\(rt\.cogs/.test(M12)
  && /\+ COALESCE\(rt\.logistica_var, \(0\)::numeric\) AS logistica_var/.test(M12)
  && /ce_rettifiche\.attiva AND ce_rettifiche\.in_amimi/.test(M12));
ok('0212: solo righe attive nelle viste e nei drill',
  /WHERE ce_rettifiche\.attiva/.test(M12) && /WHERE r\.attiva AND r\.linea = 'cogs'/.test(M12)
  && /where r\.attiva and r\.linea = 'logistica_var'/.test(M12));
ok('0212: drill COGS separa rettifica (brand) e rettifica_gift (solo Totale)',
  /THEN 'rettifica'::text ELSE 'rettifica_gift'::text/.test(M12));
ok('0212: completezza toglie la logistica rettificata dalle spese nel CE',
  /SELECT sum\(cr\.importo\) FROM ce_rettifiche cr/.test(M12) && /v_ce_completezza as/.test(M12));
ok('0212: gift mai nel brand, canale solo sul COGS, annullare lascia chi e quando',
  /canale is distinct from 'gift' or not in_amimi/.test(M12) && /canale is null or linea = 'cogs'/.test(M12)
  && /attiva or \(annullata_at is not null and annullata_by is not null\)/.test(M12));
ok('0212: regole del materiale come da brief (66 dal 09-07, 40 dal 21-09 e 01-10, 21,30 dal 07-10, 12 dal 22-09, India 2,42, soglie 30/33)',
  /then 66 else 25/.test(M12) && /2026-07-09/.test(M12) && /2026-09-21/.test(M12) && /2026-10-01/.test(M12)
  && /21\.30 else 10/.test(M12) && /2026-10-07/.test(M12) && /2026-09-22' then 12 else 10/.test(M12.replace(/date '/g, "'"))
  && /then 2\.42/.test(M12) && /costo_unitario >= 33/.test(M12) && /costo_unitario >= 30/.test(M12));
ok('0212: mai sotto il costo gia\' scritto (greatest) e niente vendite a costo 0',
  /greatest\(coalesce\(n\.nuovo, 0\), v\.c\) - v\.c/.test(M12) && /v\.c > 0/.test(M12));
ok('India: 2,42 a pezzo = (425,07 + 1.015,42 + 185) / 672', Math.abs((425.07 + 1015.42 + 185) / 672 - 2.42) < 0.005);

// imposte
ok('0212: aliquote 2026 IRES 24%, IRAP 3,9% in tabella (da confermare con lo Studio)',
  /values \(2026, 0\.24, 0\.039/.test(M12));
ok('0212: imposte sul progressivo mai sotto zero, base IRAP = MC2 + salari',
  /greatest\(utile_progressivo, 0\)/.test(M12) && /greatest\(base_irap_progressiva, 0\)/.test(M12) && /t\.mc2 - t\.salari as base_irap/.test(M12));
const VISTE = M12.split('-- viste CE')[1].split('-- drill')[0];
ok('imposte FUORI da mc1, mc2 e compenso: le sostituzioni nelle viste CE non nominano le imposte',
  VISTE.length > 500 && !/impost|ires|irap/i.test(VISTE));

// 0213: dati
ok('0213: COGS materiali febbraio-novembre 2026, scritti dal calcolo vivo',
  /from public\.v_ce_rettifica_cogs_materiali r\s+where r\.year = 2026 and r\.month between 2 and 11/.test(M13));
ok('0212: una riga COGS ha sempre il canale', /check \(linea <> 'cogs' or canale is not null\)/.test(M12));
ok('0212: anche ask_ro legge il calcolo vivo', /grant select on public\.v_ce_rettifica_cogs_materiali to ask_ro/.test(M12));
ok('0213: dazi India fuori dalla logistica solo dopo il controllo delle 2 spese UPS (-1440,49)',
  /v_tot <> -1440\.49/.test(M13) && Math.abs(425.07 + 1015.42 - 1440.49) < 0.005 && /-e\.costo/.test(M13));
ok('0213: F24 del 16-10 = 1.280,72 IVA + 123,57 ritenuta',
  Math.abs(1280.72 + 123.57 - 1404.29) < 0.005 && /costo = -1280\.72/.test(M13) && /-123\.57, 'TASSE', 'Ritenute'/.test(M13)
  && /= -1404\.29/.test(M13));
ok('0213: ri-chiusura = patch di cogs, logistica_var, mc1, mc2, con guardia prima e dopo e change_log',
  /non si muovono delle sole rettifiche/.test(M13) && /dopo la ri-chiusura restano righe diverse dal live/.test(M13)
  && /'reclose'/.test(M13) && /jsonb_build_object\('cogs', t\.j->'cogs', 'logistica_var', t\.j->'logistica_var', 'mc1', t\.j->'mc1', 'mc2', t\.j->'mc2'\)/.test(M13));
ok('0213: completezza verificata dopo', /v_ce_completezza where abs\(spese_scoperte\) > 0\.01/.test(M13));

// frontend
ok('drill COGS: rettifica nel brand, rettifica_gift solo nel Totale',
  /\['online', 'offline', 'b2b', 'gift', 'rettifica', 'rettifica_gift'\] : \['online', 'offline', 'b2b', 'rettifica'\]/.test(API));
ok('CE dettagliato: righe imposte solo nello scope Totale, da v_ce_imposte_stimate',
  /from\('v_ce_imposte_stimate'\)/.test(API) && /scope === 'totale' \|\| !r\.onlyTotale/.test(CE)
  && /k: 'utile_dopo_imposte'[^\n]*onlyTotale: true/.test(CE));
ok('CE dettagliato: le righe imposte si sommano tutte sugli stessi mesi (niente mc: 2 sull\'utile dopo imposte)',
  !/k: 'utile_dopo_imposte'[^\n]*mc: 2/.test(CE));
ok('CE dettagliato: se la vista imposte non risponde il CE si mostra lo stesso', /if \(ie\) return rows;/.test(API));

if (fail) { console.error(`\n${fail} guardie fallite`); process.exit(1); }
console.log('\ntutte le guardie ok');
