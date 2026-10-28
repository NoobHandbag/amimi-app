// tests/ads_swap_guardie.mjs: guardie sul SORGENTE della migr 0175 (cruscotto Ads, Gate 2 del 28-10-2026)
//   node tests/ads_swap_guardie.mjs
//
// La prova viva (tests/ads_swap_viste.sql) gira solo dopo l'apply e vede solo i dati del giorno: una soglia cambiata
// che oggi non sposta nessun ad passerebbe. Qui si fissa il testo della migrazione: costanti dell'owner nel CTE k e
// nessuna soglia scritta fuori da k (C2/X3), regex del pubblico (C3), join stretto della freq7 e freq_mancante/freq_al
// in coda (B1), base senza click esclusa dal segnale CTR (B2), testi del motivo (C1), v_fonti_freschezza con le
// colonne di prima nello stesso ordine e la nuova in coda (X1). Ogni controllo e' una funzione del testo: l'autocontrollo
// la prova su un sorgente rotto apposta.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n');
const M175 = read('supabase/migrations/0175_ads_swap_cruscotto.sql');
const VISTE = read('tests/ads_swap_viste.sql');
const noComments = (s) => s.replace(/--[^\n]*/g, '');
const flat = (s) => s.replace(/\s+/g, ' ');

let ok = 0, ko = 0;
const t = (n, c, extra = '') => { if (c) { ok++; console.log('  ok  ' + n); } else { ko++; console.log('  KO  ' + n + (extra ? '  <- ' + String(extra).slice(0, 200) : '')); } };

const swapDi = (src) => (noComments(src).match(/create or replace view v_ads_swap as[\s\S]*?\n from w cross join k;/) ?? [''])[0];
const RE = "'(super hot|\\mhot\\M|warm|rtg|retarget|remarketing|re-?eng)'";

const kOk = (s) => /\n k as \(\s*select 4\.0 as freq_rtg, 2\.5 as freq_cold, 76\.70 as pareggio, 0\.75 as ctr_calo,\s*1000 as impr_min, 300 as impr_consegna, 500 as impr_hook, 10 as quota_min, 21 as giorni_base\s*\),/.test(s)
  && s.split(/\n k as \(/).length === 2;
// fuori da k nessun confronto con una soglia scritta a mano (le costanti si leggono solo da k)
const soglieAMano = (s) => [...s.replace(/\n k as \([\s\S]*?\),\n/, '\n').matchAll(/(>=|<=|<|>|=)\s*(1000|300|500|10|21|76\.70?|0\.75|2\.5|4(\.0)?)\b/g)].map((m) => m[0]);
const reOk = (s) => s.split(`coalesce(nc.campaign_name, '') ~* ${RE}`).length === 2 && s.split(`coalesce(ns.adset_name, '') ~* ${RE}`).length === 2
  && (s.match(/~\*/g) || []).length === 2;
const joinOk = (s) => /\n   left join meta_ad_freq7 fq on fq\.ad_id = e\.ad_id and fq\.day = r\.d\n/.test(s) && (s.match(/meta_ad_freq7 fq\b/g) || []).length === 1;
const mancanteOk = (s) => /\(coalesce\(c\.effective_status, ''\) = 'ACTIVE' and coalesce\(m\.impressions_7, 0\) >= k\.impr_consegna\s+and fq\.freq_7d is null\) as freq_mancante,/.test(s);
const codaOk = (s) => /as ordine,\s*w\.freq_mancante, w\.freq_al\s*from w cross join k;$/.test(s);
const ctrOk = (s) => /coalesce\(y\.impressions_7 >= k\.impr_min and y\.impressions_base >= k\.impr_min and y\.link_ctr_base > 0\s+and y\.link_ctr_7 <= k\.ctr_calo \* y\.link_ctr_base, false\) as segnale_ctr/.test(s);
const scalaOk = (s) => flat(s).includes(flat(`case
       when coalesce(z.effective_status, '') <> 'ACTIVE' then 'in_pausa'
       when z.segnale_spesa or (z.segnale_freq and z.segnale_ctr) then 'cambia'
       when z.segnale_freq or z.segnale_ctr then 'osserva'
       when z.impressions_7 < k.impr_consegna then 'senza_consegna'
       when z.impressions_base < k.impr_min and coalesce(z.giorni_live, 0) < k.giorni_base then 'nuova'
       else 'ok'
     end as stato`));

console.log('\n== C2/X3: costanti dell\'owner nel CTE k, nessuna soglia fuori da k ==');
const SWAP = swapDi(M175);
{
  t('1  v_ads_swap trovata nel sorgente', SWAP.length > 2000, SWAP.length);
  t('2  k = 4.0 / 2.5 frequency, 76.70 pareggio, 0.75 calo CTR, 1000 / 300 / 500 impression, 10% quota, 21 giorni, una volta sola', kOk(SWAP));
  t('3  nessuna soglia scritta a mano fuori da k', soglieAMano(SWAP).length === 0, soglieAMano(SWAP).join(' '));
  t('4  soglia della frequency da k sul pubblico', /case when x\.pubblico = 'retargeting' then k\.freq_rtg else k\.freq_cold end as freq_soglia/.test(SWAP));
  t('5  segnale_freq = freq_7g >= soglia, false se manca', /coalesce\(y\.freq_7g >= y\.freq_soglia, false\) as segnale_freq/.test(SWAP));
  t('6  segnale_spesa = spesa 14g >= pareggio senza acquisti', /\(y\.spend_14 >= k\.pareggio and y\.purchases_14 = 0\) as segnale_spesa/.test(SWAP));
  t('7  scala dello stato: in_pausa, cambia, osserva, senza_consegna, nuova, ok', scalaOk(SWAP));
  t('8  la prova viva ricalcola con le stesse costanti scritte a mano',
    VISTE.includes("then 4.0 else 2.5 end as r_soglia") && VISTE.includes('b.impressions_7 >= 1000 and b.impressions_base >= 1000 and b.link_ctr_base > 0')
    && VISTE.includes('b.link_ctr_7 <= 0.75 * b.link_ctr_base') && VISTE.includes('b.spend_14 >= 76.70 and b.purchases_14 = 0')
    && VISTE.includes('b.impressions_7 >= 300') && VISTE.includes('when c.impressions_7 < 300 then') && VISTE.includes('c.impressions_base < 1000 and coalesce(c.giorni_live, 0) < 21'));
}

console.log('\n== C3: pubblico ==');
{
  t('9  regex del pubblico (super hot, hot come parola, warm, rtg, retarget, remarketing, re-eng) su campagna e adset', reOk(SWAP));
  t('9b la prova viva usa la stessa regex (due volte)', VISTE.split(RE).length - 1 === 2);
}

console.log('\n== B1: frequency non letta ==');
{
  t('10 join stretto della freq7 sul giorno as_of (nessuna finestra di tolleranza)', joinOk(SWAP));
  t('11 freq_mancante = ACTIVE, almeno impr_consegna impression in 7g, frequency del giorno assente', mancanteOk(SWAP));
  t('12 freq_al = max(day) di meta_ad_freq7 su ogni riga', /\n freq_ult as \(select max\(day\) as d from meta_ad_freq7\),/.test(SWAP) && /\n   cross join freq_ult fu\n/.test(SWAP) && /fu\.d as freq_al,/.test(SWAP));
  t('13 freq_mancante e freq_al IN CODA (dopo ordine)', codaOk(SWAP));
  t('14 motivo: avviso in coda con la data di as_of', /\|\| case when w\.freq_mancante then '; frequency 7g non letta per il ' \|\| to_char\(w\.as_of, 'DD-MM'\) \|\| ': segnale non valutato'\s+else '' end as motivo,/.test(SWAP));
  t('15 motivo ok: "misurato" quando la frequency manca', SWAP.includes("when 'ok' then case when w.freq_mancante then 'nessun segnale di fatica misurato' else 'nessun segnale di fatica' end"));
}

console.log('\n== B2/C1: base senza click e testo di "nuova" ==');
{
  t('16 segnale_ctr vuole link_ctr_base > 0', ctrOk(SWAP));
  t('17 ok: "CTR non confrontabile (nessun click sul link nei primi 14 giorni)" con base piena e CTR 0',
    /or coalesce\(w\.link_ctr_base, 0\) = 0\s+then '; CTR non confrontabile \('/.test(SWAP)
    && /case when w\.impressions_base >= k\.impr_min and coalesce\(w\.link_ctr_base, 0\) = 0\s+then 'nessun click sul link nei primi 14 giorni' end\) \|\| '\)'/.test(SWAP));
  t('18 nuova: "base di confronto non ancora completa (N impression nei primi 14 giorni, live da G giorni)"',
    flat(SWAP).includes(flat(`when 'nuova' then 'base di confronto non ancora completa (' || w.impressions_base || ' impression nei primi 14 giorni, live da '
                       || coalesce(w.giorni_live, 0) || ' giorni)'`)) && !/meno di 14 giorni di storia/.test(SWAP));
  t('19 grant anon/authenticated sulla vista', /\ngrant select on v_ads_swap to anon, authenticated;/.test(M175));
}

console.log('\n== X1: v_fonti_freschezza, colonne di prima nello stesso ordine e la nuova in coda ==');
const vistaFonti = (src) => (noComments(src).match(/create or replace view (?:public\.)?v_fonti_freschezza as([\s\S]*?);/i) ?? [null, ''])[1];
const colonne = (body) => [...body.matchAll(/\(\s*select\s+max\(\s*(?:\w+\.)?(\w+)\s*\)(?:\s+as\s+max)?\s+from\s+(\w+)(?:\s+where\s+([^)]*?))?\s*\)\s+as\s+(\w+)/gi)]
  .map((m) => `${m[4]}=${m[2]}.${m[1]}${m[3] ? ' where ' + m[3].replace(/\w+\./g, '').replace(/::text/g, '').replace(/\s+/g, '') : ''}`);
const alias = (body) => (body.match(/\)\s+as\s+\w+\s*(?:,|$)/gi) || []).length;
const prima = readdirSync(ROOT + 'supabase/migrations').filter((f) => /^\d{4}_.*\.sql$/.test(f) && f < '0175')
  .filter((f) => vistaFonti(read('supabase/migrations/' + f)).length > 0).sort().pop();
const fontiOk = (src, prev) => {
  const p = colonne(vistaFonti(read('supabase/migrations/' + prev))), n = colonne(vistaFonti(src));
  return n.length === p.length + 1 && n.slice(0, p.length).join('|') === p.join('|')
    && n[n.length - 1] === 'meta_ads_creative_ultimo_giorno=meta_ads_creative_daily.date';
};
{
  const bodyP = vistaFonti(read('supabase/migrations/' + prima));
  t('20 ultima definizione prima della 0175 trovata e letta per intero (parser)', !!prima && colonne(bodyP).length >= 10 && colonne(bodyP).length === alias(bodyP), `${prima}: ${colonne(bodyP).length} colonne su ${alias(bodyP)}`);
  t('21 0175: stesse colonne (nome, tabella, campo, filtro) nello stesso ordine + meta_ads_creative_ultimo_giorno in coda', fontiOk(M175, prima), colonne(vistaFonti(M175)).join(', '));
  t('22 0175: create or replace (grant e owner restano), niente drop, grant o revoke sulla vista',
    /\ncreate or replace view v_fonti_freschezza as\n/.test(M175) && !/drop view[^;]*v_fonti_freschezza/i.test(noComments(M175)) && !/(grant|revoke)[^;]*v_fonti_freschezza/i.test(noComments(M175)));
  t('22b la prova viva controlla le 11 colonne in ordine e il SELECT di ask_ro', VISTE.includes("'meta_ads_creative_ultimo_giorno' then") && VISTE.includes("array['anon', 'authenticated', 'ask_ro']"));
}

console.log('\n== autocontrollo: i controlli vedono un sorgente rotto ==');
{
  const rotto = (da, a) => { const s = M175.replace(da, a); if (s === M175) throw new Error('mutazione a vuoto: ' + da); return s; };
  t('23 k con 3.0 al posto di 2.5 -> KO', !kOk(swapDi(rotto('2.5 as freq_cold', '3.0 as freq_cold'))));
  t('23b soglia scritta a mano nella scala -> KO', soglieAMano(swapDi(rotto('z.impressions_7 < k.impr_consegna', 'z.impressions_7 < 300'))).length === 1);
  t('24 join con tolleranza di un giorno -> KO', !joinOk(swapDi(rotto('fq.day = r.d\n', 'fq.day >= r.d - 1\n'))));
  t('25 regex senza warm -> KO', !reOk(swapDi(M175.split('|warm|').join('|'))));
  t('26 segnale_ctr senza link_ctr_base > 0 -> KO', !ctrOk(swapDi(rotto(' and y.link_ctr_base > 0', ''))));
  t('27 freq_mancante prima di ordine -> KO', !codaOk(swapDi(rotto('as ordine,\n   w.freq_mancante, w.freq_al', 'as ordine'))));
  t('28 due colonne di v_fonti_freschezza scambiate -> KO', !fontiOk(rotto(`FROM shopify_orders) AS ultimo_ordine_shopify,
    ( SELECT max(shopify_orders.synced_at) AS max
           FROM shopify_orders) AS ultimo_sync_ordini,`, `FROM shopify_orders) AS ultimo_sync_ordini,
    ( SELECT max(shopify_orders.synced_at) AS max
           FROM shopify_orders) AS ultimo_ordine_shopify,`), prima));
  t('28b filtro della spesa approvata tolto -> KO', !fontiOk(rotto(`\n          WHERE expenses.status = 'approved'::text) AS ultima_spesa_pagata`, ') AS ultima_spesa_pagata'), prima));
}

console.log(`\n${ok} ok, ${ko} KO`);
process.exit(ko ? 1 : 0);
